/**
 * Traduce el SQL escrito para SQLite al dialecto de PostgreSQL.
 *
 * El codigo de la app escribe una sola consulta y el motor la adapta. Solo cubre las
 * construcciones que la app usa (ver tests/db/translate.test.ts); lo que no reconoce
 * lo deja intacto para que falle de forma visible en vez de cambiar su significado.
 *
 * - `?`                         -> $1, $2, ...
 * - datetime('now'[, '-N u'])   -> marca de tiempo UTC (timestamp sin zona)
 * - date('now'[, mods])         -> fecha UTC; date(x) -> (x)::date
 * - strftime('%Y-%m', x)        -> to_char(...)
 * - julianday(x)                -> dias julianos desde epoch
 * - MAX(a, b) / MIN(a, b)       -> GREATEST / LEAST (las de un argumento son agregados)
 * - GROUP_CONCAT(x[, sep])      -> string_agg(CAST(x AS TEXT), sep)
 * - substr(x, ...)              -> substr(CAST(x AS TEXT), ...)
 * - IFNULL                      -> COALESCE
 * - LIKE                        -> ILIKE (en SQLite LIKE no distingue mayusculas)
 * - INSERT OR IGNORE            -> INSERT ... ON CONFLICT DO NOTHING
 */

type Token = { kind: "string" | "quoted" | "code"; text: string };

/** Separa el SQL en codigo, literales '...' e identificadores "..." para no tocar lo que va entre comillas. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let code = "";
  const flush = () => { if (code) { tokens.push({ kind: "code", text: code }); code = ""; } };
  while (index < sql.length) {
    const char = sql[index];
    if (char === "'" || char === '"') {
      flush();
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          if (sql[end + 1] === char) { end += 2; continue; }
          break;
        }
        end += 1;
      }
      tokens.push({ kind: char === "'" ? "string" : "quoted", text: sql.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);
      code += end === -1 ? sql.slice(index) : sql.slice(index, end);
      index = end === -1 ? sql.length : end;
      continue;
    }
    code += char;
    index += 1;
  }
  flush();
  return tokens;
}

function join(tokens: Token[]) {
  return tokens.map(token => token.text).join("");
}

/** Reemplaza `?` por $n fuera de literales. */
function numberPlaceholders(sql: string) {
  let counter = 0;
  return tokenize(sql).map(token => token.kind === "code" ? token.text.replace(/\?/g, () => `$${++counter}`) : token.text).join("");
}

/**
 * Busca llamadas `name(` en el SQL (fuera de literales) y devuelve sus argumentos de primer nivel,
 * respetando parentesis anidados y comillas.
 */
function rewriteCalls(sql: string, name: string, rewrite: (args: string[], original: string) => string | null): string {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let output = "";
  let cursor = 0;
  const literalRanges: Array<[number, number]> = [];
  {
    let position = 0;
    for (const token of tokenize(sql)) {
      if (token.kind !== "code") literalRanges.push([position, position + token.text.length]);
      position += token.text.length;
    }
  }
  const insideLiteral = (at: number) => literalRanges.some(([start, end]) => at >= start && at < end);

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    const start = match.index;
    if (start < cursor || insideLiteral(start)) continue;
    // Evita coincidir con sufijos de otros nombres (p. ej. "to_date(").
    if (start > 0 && /[A-Za-z0-9_.]/.test(sql[start - 1])) continue;
    let depth = 0;
    let index = start + match[0].length - 1;
    const args: string[] = [];
    let argStart = index + 1;
    let quote: string | null = null;
    for (; index < sql.length; index += 1) {
      const char = sql[index];
      if (quote) {
        if (char === quote) {
          if (sql[index + 1] === quote) { index += 1; continue; }
          quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) { args.push(sql.slice(argStart, index)); break; }
      } else if (char === "," && depth === 1) {
        args.push(sql.slice(argStart, index));
        argStart = index + 1;
      }
    }
    if (depth !== 0) break;
    const original = sql.slice(start, index + 1);
    const replacement = rewrite(args.map(arg => arg.trim()), original);
    output += sql.slice(cursor, start) + (replacement ?? original);
    cursor = index + 1;
    pattern.lastIndex = cursor;
  }
  return output + sql.slice(cursor);
}

const NOW_UTC = "(now() AT TIME ZONE 'UTC')";
const TODAY_UTC = "((now() AT TIME ZONE 'UTC')::date)";

function unquote(value: string) {
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : null;
}

/** Modificadores de SQLite ('-1 day', '+30 days', 'start of month') como expresion de intervalo. */
function applyModifiers(base: string, modifiers: string[]): string | null {
  let expression = base;
  for (const raw of modifiers) {
    const modifier = unquote(raw);
    if (modifier === null) return null;
    const normalized = modifier.trim().toLowerCase();
    if (normalized === "start of month") {
      expression = `date_trunc('month', ${expression})`;
      continue;
    }
    if (normalized === "start of day") {
      expression = `date_trunc('day', ${expression})`;
      continue;
    }
    const amount = /^([+-]?\d+(?:\.\d+)?)\s+(second|minute|hour|day|month|year)s?$/.exec(normalized);
    if (!amount) return null;
    const value = Number(amount[1]);
    expression = `(${expression} ${value < 0 ? "-" : "+"} interval '${Math.abs(value)} ${amount[2]}s')`;
  }
  return expression;
}

function translateDateFunctions(sql: string) {
  let result = rewriteCalls(sql, "datetime", args => {
    if (!args.length) return null;
    const base = unquote(args[0]) === "now" ? NOW_UTC : `(${args[0]})::timestamp`;
    const expression = applyModifiers(base, args.slice(1));
    return expression ? `(${expression})::timestamp` : null;
  });
  result = rewriteCalls(result, "date", args => {
    if (!args.length) return null;
    const base = unquote(args[0]) === "now" ? TODAY_UTC : `(${args[0]})::date`;
    if (args.length === 1) return base;
    const expression = applyModifiers(`${base}::timestamp`, args.slice(1));
    return expression ? `(${expression})::date` : null;
  });
  result = rewriteCalls(result, "strftime", args => {
    const format = unquote(args[0] ?? "");
    if (format === null || args.length < 2) return null;
    const pgFormat = format.replace("%Y", "YYYY").replace("%m", "MM").replace("%d", "DD").replace("%H", "HH24").replace("%M", "MI").replace("%S", "SS");
    const value = unquote(args[1]) === "now" ? NOW_UTC : `(${args[1]})::timestamp`;
    const expression = applyModifiers(value, args.slice(2));
    return expression ? `to_char(${expression}, '${pgFormat}')` : null;
  });
  result = rewriteCalls(result, "julianday", args => {
    if (args.length !== 1) return null;
    const value = unquote(args[0]) === "now" ? NOW_UTC : `(${args[0]})::timestamp`;
    return `(EXTRACT(EPOCH FROM ${value}) / 86400.0 + 2440587.5)`;
  });
  return result;
}

function translateScalarFunctions(sql: string) {
  let result = rewriteCalls(sql, "MAX", args => args.length === 2 ? `GREATEST(${args[0]}, ${args[1]})` : null);
  result = rewriteCalls(result, "MIN", args => args.length === 2 ? `LEAST(${args[0]}, ${args[1]})` : null);
  result = rewriteCalls(result, "GROUP_CONCAT", args => {
    if (!args.length || args.length > 2) return null;
    return `string_agg(CAST(${args[0]} AS TEXT), ${args[1] ?? "','"})`;
  });
  result = rewriteCalls(result, "substr", args => args.length >= 2 ? `substr(CAST(${args[0]} AS TEXT), ${args.slice(1).join(", ")})` : null);
  result = rewriteCalls(result, "IFNULL", args => args.length === 2 ? `COALESCE(${args[0]}, ${args[1]})` : null);
  return result;
}

function translateKeywords(sql: string) {
  let insertOrIgnore = false;
  const tokens = tokenize(sql).map(token => {
    if (token.kind !== "code") return token;
    let text = token.text;
    if (/\bINSERT\s+OR\s+IGNORE\b/i.test(text)) {
      insertOrIgnore = true;
      text = text.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
    }
    text = text.replace(/\bNOT\s+LIKE\b/gi, "NOT ILIKE").replace(/(?<!NOT\s)\bLIKE\b/gi, "ILIKE");
    return { ...token, text };
  });
  let result = join(tokens);
  if (insertOrIgnore && !/\bON\s+CONFLICT\b/i.test(result)) {
    result = result.replace(/;?\s*$/, "") + " ON CONFLICT DO NOTHING";
  }
  return result;
}

const cache = new Map<string, string>();

export function translateSqliteToPostgres(sql: string): string {
  const cached = cache.get(sql);
  if (cached !== undefined) return cached;
  let result = translateKeywords(sql);
  result = translateDateFunctions(result);
  result = translateScalarFunctions(result);
  result = numberPlaceholders(result);
  if (cache.size < 5000) cache.set(sql, result);
  return result;
}

/** Para INSERT sin RETURNING agrega `RETURNING *`, de modo que run() pueda devolver el id creado. */
export function withReturning(sql: string): string {
  if (!/^\s*INSERT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return sql.replace(/;?\s*$/, "") + " RETURNING *";
}
