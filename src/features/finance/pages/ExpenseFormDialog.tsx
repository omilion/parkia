import { useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UploadCloud } from 'lucide-react';

import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { expenseFieldsSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';
import { todayLocal } from '../../../../shared/dates';

function ExpenseField({ id, label, error, children }: { id: string; label: string; error?: { message?: string }; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={formLabelClass}>{label}</label>
      {children}
      <FieldError error={error} />
    </div>
  );
}

export default function ExpenseFormDialog() {
  const { branches, closeExpenseDrawer, editingExpense, handleSaveExpense, isExpenseDrawerOpen, isSavingExpense, selectedBranchId, selectedExpenseReceiptName, setSelectedExpenseReceiptName } = useFinance();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const form = useForm({
    resolver: zodResolver(expenseFieldsSchema),
    defaultValues: {
      date: editingExpense?.date || todayLocal(),
      category: editingExpense?.category || 'maintenance',
      supplier_name: editingExpense?.supplier_name || '',
      supplier_rut: editingExpense?.supplier_rut || '',
      description: editingExpense?.description || '',
      cost_center: editingExpense?.cost_center || 'general',
      branch_id: String(editingExpense?.branch_id || (selectedBranchId === 'all' ? '' : selectedBranchId)),
      amount_net: editingExpense?.amount_net || '',
      tax_amount: editingExpense?.tax_amount || 0,
      amount_total: editingExpense?.amount_total || '',
      document_type: editingExpense?.document_type || 'invoice',
      document_number: editingExpense?.document_number || '',
      payment_status: editingExpense?.payment_status || 'pending',
      due_date: editingExpense?.due_date || '',
      paid_at: editingExpense?.paid_at || '',
      payment_method: editingExpense?.payment_method || '',
      notes: editingExpense?.notes || '',
    },
  });
  const { errors } = form.formState;
  const invalid = (name: keyof typeof errors) => (errors[name] ? true : undefined);
  return (<Drawer
        isOpen={isExpenseDrawerOpen}
        onClose={closeExpenseDrawer}
        title={editingExpense ? "Editar Gasto" : "Registrar Gasto"}
      >
        <form noValidate onSubmit={form.handleSubmit(values => handleSaveExpense(values, receiptFile))} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ExpenseField id="expense-date" label="Fecha" error={errors.date}>
              <input id="expense-date" type="date" aria-invalid={invalid('date')} {...form.register('date')} className={formInputClass} />
            </ExpenseField>
            <ExpenseField id="expense-category" label="Categoría" error={errors.category}>
              <select id="expense-category" {...form.register('category')} className={formInputClass}>
                <option value="rent">Arriendo</option>
                <option value="maintenance">Mantención</option>
                <option value="utilities">Servicios</option>
                <option value="payroll">Sueldos</option>
                <option value="supplies">Insumos</option>
                <option value="taxes">Impuestos</option>
                <option value="admin">Administración</option>
                <option value="other">Otros</option>
              </select>
            </ExpenseField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ExpenseField id="expense-supplier" label="Proveedor" error={errors.supplier_name}>
              <input id="expense-supplier" aria-invalid={invalid('supplier_name')} {...form.register('supplier_name')} className={formInputClass} />
            </ExpenseField>
            <ExpenseField id="expense-supplier-rut" label="RUT Proveedor" error={errors.supplier_rut}>
              <input id="expense-supplier-rut" {...form.register('supplier_rut')} className={formInputClass} />
            </ExpenseField>
          </div>

          <ExpenseField id="expense-description" label="Descripción" error={errors.description}>
            <input id="expense-description" aria-invalid={invalid('description')} {...form.register('description')} placeholder="Ej: Reparación portón acceso principal" className={formInputClass} />
          </ExpenseField>

          <ExpenseField id="expense-cost-center" label="Centro de Costo" error={errors.cost_center}>
            <select id="expense-cost-center" {...form.register('cost_center')} className={formInputClass}>
              <option value="general">General</option>
              <option value="operations">Operación</option>
              <option value="maintenance">Mantención</option>
              <option value="security">Seguridad</option>
              <option value="administration">Administración</option>
              <option value="taxes">Impuestos</option>
            </select>
          </ExpenseField>

          <ExpenseField id="expense-branch" label="Sucursal" error={errors.branch_id}>
            <select id="expense-branch" {...form.register('branch_id')} className={formInputClass}>
              <option value="">Sin sucursal</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </ExpenseField>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ExpenseField id="expense-net" label="Neto" error={errors.amount_net}>
              <input id="expense-net" type="number" inputMode="numeric" min="0" step="1" aria-invalid={invalid('amount_net')} {...form.register('amount_net')} className={formInputClass} />
            </ExpenseField>
            <ExpenseField id="expense-tax" label="IVA/Impuesto" error={errors.tax_amount}>
              <input id="expense-tax" type="number" inputMode="numeric" min="0" step="1" aria-invalid={invalid('tax_amount')} {...form.register('tax_amount')} className={formInputClass} />
            </ExpenseField>
            <ExpenseField id="expense-total" label="Total" error={errors.amount_total}>
              <input id="expense-total" type="number" inputMode="numeric" min="1" step="1" aria-invalid={invalid('amount_total')} {...form.register('amount_total')} className={formInputClass} />
            </ExpenseField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ExpenseField id="expense-document-type" label="Documento" error={errors.document_type}>
              <select id="expense-document-type" {...form.register('document_type')} className={formInputClass}>
                <option value="invoice">Factura</option>
                <option value="receipt">Recibo</option>
                <option value="ticket">Boleta</option>
                <option value="internal">Orden interna</option>
                <option value="none">Sin documento</option>
              </select>
            </ExpenseField>
            <ExpenseField id="expense-document-number" label="Folio/Número" error={errors.document_number}>
              <input id="expense-document-number" {...form.register('document_number')} className={formInputClass} />
            </ExpenseField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ExpenseField id="expense-status" label="Estado" error={errors.payment_status}>
              <select id="expense-status" {...form.register('payment_status')} className={formInputClass}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="overdue">Vencido</option>
                <option value="cancelled">Anulado</option>
              </select>
            </ExpenseField>
            <ExpenseField id="expense-due" label="Vencimiento" error={errors.due_date}>
              <input id="expense-due" type="date" aria-invalid={invalid('due_date')} {...form.register('due_date')} className={formInputClass} />
            </ExpenseField>
            <ExpenseField id="expense-paid-at" label="Pagado el" error={errors.paid_at}>
              <input id="expense-paid-at" type="date" aria-invalid={invalid('paid_at')} {...form.register('paid_at')} className={formInputClass} />
            </ExpenseField>
          </div>

          <ExpenseField id="expense-method" label="Método de pago" error={errors.payment_method}>
            <select id="expense-method" {...form.register('payment_method')} className={formInputClass}>
              <option value="">Sin definir</option>
              <option value="transfer">Transferencia</option>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="automatic">Débito automático</option>
              <option value="other">Otro</option>
            </select>
          </ExpenseField>

          <div>
            <p className={formLabelClass}>Respaldo</p>
            <label className="border-2 border-dashed border-slate-200 rounded-3xl p-5 flex flex-col items-center justify-center text-center hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50 focus-within:border-slate-900">
              <UploadCloud className="w-8 h-8 text-slate-300 mb-2" aria-hidden="true" />
              <span className="text-sm font-bold text-slate-900">Seleccionar respaldo</span>
              <span className="text-xs text-slate-600 mt-1">{selectedExpenseReceiptName || editingExpense?.receipt_file_name || 'JPG, PNG o PDF hasta 5MB'}</span>
              <input type="file" aria-label="Respaldo" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setReceiptFile(file);
                setSelectedExpenseReceiptName(file?.name || '');
              }} />
            </label>
          </div>

          <ExpenseField id="expense-notes" label="Notas" error={errors.notes}>
            <textarea id="expense-notes" rows={4} {...form.register('notes')} className={`${formInputClass} resize-none`} />
          </ExpenseField>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={closeExpenseDrawer} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isSavingExpense} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isSavingExpense ? 'Guardando...' : editingExpense ? 'Guardar Gasto' : 'Registrar Gasto'}
            </button>
          </div>
        </form>
      </Drawer>);
}
