import assert from "node:assert/strict";
import { test } from "node:test";
import { localParts, localToInstant, quote, validatePlan, type PricingPlan } from "../../server/modules/tickets/pricing-engine";

/** Instante a partir de hora de Chile (America/Santiago), para escribir los casos como los vive el operador. */
const chile = (date: string, time: string) => new Date(localToInstant(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)), "America/Santiago"));

const flat = (pricePerMinute: number, extra: Partial<PricingPlan> = {}): PricingPlan => ({
  mode: "per_minute", graceMins: 0, timeZone: "America/Santiago",
  rules: [{ weekdays: null, from: "00:00", to: "24:00", priority: 0, pricePerMinute }],
  ...extra,
});

test("solo se cobran minutos completos transcurridos (sin redondeo al alza)", () => {
  const plan = flat(10);
  const entry = new Date("2026-06-10T14:00:00Z");
  // 59 segundos: ningun minuto completo.
  assert.equal(quote(plan, entry, new Date(entry.getTime() + 59_000)).subtotal, 0);
  // 60 segundos: un minuto.
  assert.equal(quote(plan, entry, new Date(entry.getTime() + 60_000)).subtotal, 10);
  // 1 min 59 s: un minuto, no dos.
  const almostTwo = quote(plan, entry, new Date(entry.getTime() + 119_000));
  assert.equal(almostTwo.durationMins, 1);
  assert.equal(almostTwo.subtotal, 10);
});

test("la gracia se descuenta del inicio del tiempo cobrable", () => {
  const plan = flat(10, { graceMins: 15 });
  const entry = new Date("2026-06-10T14:00:00Z");
  assert.equal(quote(plan, entry, new Date(entry.getTime() + 15 * 60_000)).subtotal, 0);
  const result = quote(plan, entry, new Date(entry.getTime() + 45 * 60_000));
  assert.equal(result.billableMins, 30);
  assert.equal(result.subtotal, 300);
});

test("convenios: minutos gratis adicionales se suman a la gracia", () => {
  const plan = flat(10, { graceMins: 10 });
  const entry = new Date("2026-06-10T14:00:00Z");
  const result = quote(plan, entry, new Date(entry.getTime() + 60 * 60_000), { extraFreeMins: 20 });
  assert.equal(result.billableMins, 30);
  assert.equal(result.subtotal, 300);
});

test("precio distinto por horario (diurno / nocturno) y cruce de medianoche", () => {
  const plan: PricingPlan = {
    mode: "per_minute", graceMins: 0, timeZone: "America/Santiago",
    rules: [
      { weekdays: null, from: "00:00", to: "24:00", priority: 0, pricePerMinute: 20 },
      { weekdays: null, from: "22:00", to: "06:00", priority: 1, pricePerMinute: 5 }, // nocturno, cruza medianoche
    ],
  };
  // 21:00 a 23:00 -> 60 min x 20 + 60 min x 5
  assert.equal(quote(plan, chile("2026-06-10", "21:00"), chile("2026-06-10", "23:00")).subtotal, 60 * 20 + 60 * 5);
  // 23:30 a 01:30 (cruza medianoche) -> todo nocturno: 120 x 5
  assert.equal(quote(plan, chile("2026-06-10", "23:30"), chile("2026-06-11", "01:30")).subtotal, 120 * 5);
  // 05:00 a 07:00 -> 60 x 5 + 60 x 20
  assert.equal(quote(plan, chile("2026-06-11", "05:00"), chile("2026-06-11", "07:00")).subtotal, 60 * 5 + 60 * 20);
});

test("reglas por dia de la semana: fin de semana mas barato", () => {
  const plan: PricingPlan = {
    mode: "per_minute", graceMins: 0, timeZone: "America/Santiago",
    rules: [
      { weekdays: null, from: "00:00", to: "24:00", priority: 0, pricePerMinute: 30 },
      { weekdays: [6, 7], from: "00:00", to: "24:00", priority: 1, pricePerMinute: 10 },
    ],
  };
  // 2026-06-12 es viernes; 2026-06-13 sabado. Viernes 23:00 a sabado 01:00.
  const result = quote(plan, chile("2026-06-12", "23:00"), chile("2026-06-13", "01:00"));
  assert.equal(result.subtotal, 60 * 30 + 60 * 10);
  assert.deepEqual(result.days.map(day => [day.date, day.amount]), [["2026-06-12", 1800], ["2026-06-13", 600]]);
});

test("tope diario por dia calendario y estadias de varios dias", () => {
  const plan = flat(10, { dailyCap: 5000 });
  // Un dia completo (24 h = 14.400) topa en 5.000.
  assert.equal(quote(plan, chile("2026-06-10", "00:00"), chile("2026-06-11", "00:00")).subtotal, 5000);
  // 10:00 a 10:00 del dia siguiente: 14 h el primer dia (8.400 -> tope 5.000) y 10 h el segundo (6.000 -> 5.000).
  const twoDays = quote(plan, chile("2026-06-10", "10:00"), chile("2026-06-11", "10:00"));
  assert.equal(twoDays.uncappedSubtotal, 14_400);
  assert.equal(twoDays.subtotal, 10_000);
  assert.deepEqual(twoDays.days.map(day => day.capped), [true, true]);
  // 3 dias y medio: 3 topes + medio dia sin tope (5 h = 3.000).
  const long = quote(plan, chile("2026-06-10", "00:00"), chile("2026-06-13", "05:00"));
  assert.equal(long.subtotal, 5000 * 3 + 300 * 10);
  // Por debajo del tope no cambia nada.
  assert.equal(quote(plan, chile("2026-06-10", "10:00"), chile("2026-06-10", "11:00")).subtotal, 600);
});

test("cambio de hora de verano: se cobra el tiempo real transcurrido, no el del reloj de pared", () => {
  // Chile retrasa el reloj la noche del sabado 5 al domingo 6 de abril de 2025 (24:00 -> 23:00): esa noche dura 25 h.
  const plan = flat(1);
  const entry = new Date(localToInstant("2025-04-05", 22 * 60, "America/Santiago"));
  const exit = new Date(localToInstant("2025-04-06", 6 * 60, "America/Santiago"));
  assert.equal(quote(plan, entry, exit).durationMins, 9 * 60, "de 22:00 a 06:00 pasaron 9 horas reales");

  // Y el inicio del horario de verano (se adelanta, 24:00 -> 01:00 del domingo 7 de septiembre de 2025): noche de 23 h.
  const spring = quote(plan, new Date(localToInstant("2025-09-06", 22 * 60, "America/Santiago")), new Date(localToInstant("2025-09-07", 6 * 60, "America/Santiago")));
  assert.equal(spring.durationMins, 7 * 60, "de 22:00 a 06:00 pasaron 7 horas reales");

  // La regla nocturna sigue aplicandose por hora local alrededor del cambio.
  const night: PricingPlan = {
    mode: "per_minute", graceMins: 0, timeZone: "America/Santiago",
    rules: [
      { weekdays: null, from: "00:00", to: "24:00", priority: 0, pricePerMinute: 10 },
      { weekdays: null, from: "22:00", to: "06:00", priority: 1, pricePerMinute: 2 },
    ],
  };
  const around = quote(night, new Date(localToInstant("2025-04-05", 21 * 60, "America/Santiago")), new Date(localToInstant("2025-04-06", 7 * 60, "America/Santiago")));
  // 21-22 diurno (60 x 10) + 22-06 nocturno 9 h reales (540 x 2) + 06-07 diurno (60 x 10)
  assert.equal(around.subtotal, 600 + 540 * 2 + 600);
});

test("tramos vencidos: solo se cobra el tramo cumplido", () => {
  const plan: PricingPlan = {
    mode: "elapsed_blocks", graceMins: 0, firstBlockMinutes: 30, blockMinutes: 10, timeZone: "America/Santiago",
    rules: [{ weekdays: null, from: "00:00", to: "24:00", priority: 0, firstBlockPrice: 1500, blockPrice: 400 }],
  };
  const at = (mins: number) => quote(plan, new Date("2026-06-10T14:00:00Z"), new Date(Date.UTC(2026, 5, 10, 14, mins)));
  assert.equal(at(29).subtotal, 0, "antes de cumplir el primer tramo no se cobra");
  assert.equal(at(30).subtotal, 1500);
  assert.equal(at(39).subtotal, 1500, "el segundo tramo aun no vence");
  assert.equal(at(40).subtotal, 1900);
  assert.equal(at(70).subtotal, 1500 + 400 * 4);
  assert.equal(at(70).blocksCharged, 5);
  assert.equal(at(75).minutesIntoCurrentBlock, 5);
});

test("tramos: la gracia corre antes del primer tramo y el tope diario aplica", () => {
  const plan: PricingPlan = {
    mode: "elapsed_blocks", graceMins: 10, firstBlockMinutes: 30, blockMinutes: 15, dailyCap: 3000, timeZone: "America/Santiago",
    rules: [{ weekdays: null, from: "00:00", to: "24:00", priority: 0, firstBlockPrice: 1000, blockPrice: 600 }],
  };
  const entry = new Date("2026-06-10T14:00:00Z");
  assert.equal(quote(plan, entry, new Date(entry.getTime() + 39 * 60_000)).subtotal, 0);
  assert.equal(quote(plan, entry, new Date(entry.getTime() + 40 * 60_000)).subtotal, 1000);
  // 6 horas: topa en 3.000 aunque los tramos sumen mas.
  const long = quote(plan, chile("2026-06-10", "08:00"), chile("2026-06-10", "14:00"));
  assert.ok(long.uncappedSubtotal > 3000);
  assert.equal(long.subtotal, 3000);
});

test("tramos con precio distinto por horario usan el precio de la regla donde empieza el tramo", () => {
  const plan: PricingPlan = {
    mode: "elapsed_blocks", graceMins: 0, firstBlockMinutes: 30, blockMinutes: 30, timeZone: "America/Santiago",
    rules: [
      { weekdays: null, from: "00:00", to: "24:00", priority: 0, blockPrice: 1000 },
      { weekdays: null, from: "20:00", to: "24:00", priority: 1, blockPrice: 500 },
    ],
  };
  // 19:00 a 21:00: 4 tramos; los de 19:00 y 19:30 a 1.000, los de 20:00 y 20:30 a 500.
  assert.equal(quote(plan, chile("2026-06-10", "19:00"), chile("2026-06-10", "21:00")).subtotal, 1000 + 1000 + 500 + 500);
});

test("estadias cortas, salida antes de la entrada y tiempos exactos", () => {
  const plan = flat(7);
  const entry = new Date("2026-06-10T14:00:00Z");
  assert.equal(quote(plan, entry, entry).subtotal, 0);
  assert.equal(quote(plan, entry, new Date(entry.getTime() - 60_000)).durationMins, 0);
});

test("validacion: minimos legales de tramos, precios enteros y cobertura horaria", () => {
  const rule = { weekdays: null, from: "00:00", to: "24:00", priority: 0, firstBlockPrice: 1000, blockPrice: 500 };
  const blocks = (first: number, next: number): PricingPlan => ({ mode: "elapsed_blocks", graceMins: 0, firstBlockMinutes: first, blockMinutes: next, rules: [rule] });
  assert.deepEqual(validatePlan(blocks(30, 10)), []);
  assert.match(validatePlan(blocks(29, 10)).join(" "), /primer tramo dura al menos 30/);
  assert.match(validatePlan(blocks(30, 9)).join(" "), /siguientes duran al menos 10/);

  assert.match(validatePlan(flat(12.5)).join(" "), /precio por minuto/);
  assert.match(validatePlan(flat(10, { graceMins: -1 })).join(" "), /gracia/);
  assert.match(validatePlan(flat(10, { dailyCap: 0 })).join(" "), /tope diario/);
  assert.match(validatePlan({ ...flat(10), rules: [] }).join(" "), /al menos una regla/);
  assert.match(validatePlan({ ...flat(10), timeZone: "Marte/Olimpo" }).join(" "), /Zona horaria/);

  const gaps: PricingPlan = { mode: "per_minute", graceMins: 0, rules: [{ weekdays: null, from: "08:00", to: "20:00", priority: 0, pricePerMinute: 10 }] };
  assert.match(validatePlan(gaps).join(" "), /sin precio: lunes 00:00-08:00/);
  const covered: PricingPlan = { mode: "per_minute", graceMins: 0, rules: [
    { weekdays: null, from: "08:00", to: "20:00", priority: 0, pricePerMinute: 10 },
    { weekdays: null, from: "20:00", to: "08:00", priority: 0, pricePerMinute: 4 },
  ] };
  assert.deepEqual(validatePlan(covered), [], "dos ventanas que juntas cubren las 24 h son validas");
});

test("hora local: dia de la semana y cambio de dia segun la zona", () => {
  // 2026-06-11 02:30 UTC es el 10 de junio 22:30 en Chile (invierno, UTC-4).
  const parts = localParts(Date.UTC(2026, 5, 11, 2, 30), "America/Santiago");
  assert.equal(parts.date, "2026-06-10");
  assert.equal(parts.minutes, 22 * 60 + 30);
  assert.equal(parts.isoWeekday, 3); // miercoles
});
