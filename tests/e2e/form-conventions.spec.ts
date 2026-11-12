import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * Convención de Fase 2: los formularios de datos usan react-hook-form con un esquema Zod,
 * y las reglas viven en shared/schemas para que la API valide lo mismo.
 */

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? sourceFiles(join(dir, item.name)) : /\.tsx$/.test(item.name) ? [join(dir, item.name)] : [],
  );

/** Formularios que no son de datos y por eso no usan useForm. */
const allowedWithoutUseForm: Record<string, string> = {
  'src/features/spaces/pages/VisitorOperationsPanel.tsx': 'búsqueda de un ticket por patente (un solo campo de filtro)',
  'src/features/contracts/components/ContractUploadDialog.tsx': 'solo adjunta un archivo; se valida con documentFileError compartido',
};

test('ningún formulario lee FormData y todo formulario de datos usa useForm', () => {
  const files = sourceFiles('src').map(file => ({ file: file.replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }));

  const withFormData = files.filter(({ text }) => /new FormData\(/.test(text)).map(({ file }) => file);
  expect(withFormData, 'Usa react-hook-form en lugar de leer FormData').toEqual([]);

  const formsWithoutUseForm = files
    .filter(({ text }) => /<form[\s>]/.test(text) && !/\buseForm\s*[<(]/.test(text))
    .map(({ file }) => file)
    .filter(file => !(file in allowedWithoutUseForm));
  expect(formsWithoutUseForm, 'Formulario sin useForm: migrarlo o justificarlo en allowedWithoutUseForm').toEqual([]);
});

test('los esquemas de shared/schemas los usa también la API', () => {
  const serverFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(item =>
      item.isDirectory() ? serverFiles(join(dir, item.name)) : /\.ts$/.test(item.name) ? [join(dir, item.name)] : [],
    );
  const serverText = serverFiles('server').map(file => readFileSync(file, 'utf8')).join('\n');
  const schemaModules = readdirSync('shared/schemas').filter(name => name.endsWith('.ts') && name !== 'common.ts').map(name => name.replace(/\.ts$/, ''));
  const unused = schemaModules.filter(name => !serverText.includes(`shared/schemas/${name}`));
  expect(unused, 'Cada módulo de reglas compartidas debe validar también en el servidor').toEqual([]);
});
