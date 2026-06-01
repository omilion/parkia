import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('tioluchin.db');

const query = `
    SELECT 
        c.name as Nombre,
        c.rut as RUT,
        c.email as Email,
        c.phone as Telefono,
        c.type as Tipo,
        c.financial_status as 'Estado Financiero',
        c.created_at as 'Fecha Registro',
        -- Vehículos
        (SELECT GROUP_CONCAT(v.plate || ' (' || COALESCE(v.brand, '') || ' ' || COALESCE(v.model, '') || ')', '; ') 
         FROM vehicles v WHERE v.client_id = c.id) as 'Vehículos Detallados',
        -- Contratos
        (SELECT GROUP_CONCAT(s.name || ' [' || s.type || ']', '; ') 
         FROM contracts con JOIN spaces s ON con.space_id = s.id 
         WHERE con.client_id = c.id AND con.status = 'active') as 'Servicios Activos',
        (SELECT SUM(con.monthly_fee) FROM contracts con WHERE con.client_id = c.id AND con.status = 'active') as 'Monto Mensual',
        (SELECT MIN(start_date) FROM contracts WHERE client_id = c.id) as 'Primer Contrato',
        -- Pagos
        (SELECT COUNT(*) FROM payments p JOIN contracts con ON p.contract_id = con.id WHERE con.client_id = c.id AND p.status = 'paid') as 'Pagos Realizados',
        (SELECT SUM(amount) FROM payments p JOIN contracts con ON p.contract_id = con.id WHERE con.client_id = c.id AND p.status = 'paid') as 'Total Pagado',
        (SELECT SUM(amount) FROM payments p JOIN contracts con ON p.contract_id = con.id WHERE con.client_id = c.id AND p.status = 'pending') as 'Total Pendiente',
        (SELECT MAX(payment_date) FROM payments p JOIN contracts con ON p.contract_id = con.id WHERE con.client_id = c.id) as 'Último Pago',
        -- Facturación
        (SELECT MAX(folio) FROM invoices WHERE client_id = c.id) as 'Último Folio',
        (SELECT SUM(amount) FROM invoices WHERE client_id = c.id) as 'Total Facturado',
        -- Accesos
        (SELECT MAX(timestamp) FROM access_logs WHERE client_id = c.id) as 'Última Actividad',
        (SELECT method FROM access_logs WHERE client_id = c.id ORDER BY timestamp DESC LIMIT 1) as 'Último Método Acceso',
        (SELECT COUNT(*) FROM access_logs WHERE client_id = c.id AND access_type = 'entry') as 'Total Ingresos'
    FROM clients c
`;


const data = db.prepare(query).all();

if (data.length === 0) {
    console.log("No se encontraron datos de clientes.");
} else {
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            const val = row[header] === null ? '' : row[header];
            // Escape commas and quotes for CSV
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');

    fs.writeFileSync('reporte_clientes_detallado.csv', '\ufeff' + csvContent); // BOM for Excel UTF-8
    console.log("Reporte detallado generado con éxito: reporte_clientes_detallado.csv");
}
