import { applyDteMigration } from "../modules/dte/migration";

type Migration = {
  id: string;
  up: (db: any) => void;
  transaction?: boolean;
};

export function initializeSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row: { id: string }) => row.id)
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const applyMigration = () => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
    };

    if (migration.transaction === false) {
      applyMigration();
    } else {
      db.transaction(applyMigration)();
    }
  }
}

function tableExists(db: any, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}

function columnExists(db: any, table: string, column: string) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row: { name: string }) => row.name === column);
}

function addColumnIfMissing(db: any, table: string, column: string, definition: string) {
  if (!tableExists(db, table) || columnExists(db, table, column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

const migrations: Migration[] = [
  {
    id: "001_initial_schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          rut TEXT UNIQUE,
          type TEXT CHECK(type IN ('natural', 'company')) DEFAULT 'natural',
          financial_status TEXT CHECK(financial_status IN ('up-to-date', 'overdue')) DEFAULT 'up-to-date',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS spaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('parking', 'storage')) NOT NULL,
          status TEXT CHECK(status IN ('available', 'occupied', 'maintenance')) DEFAULT 'available',
          price REAL NOT NULL,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER,
          space_id INTEGER,
          start_date DATE NOT NULL,
          end_date DATE,
          monthly_fee REAL NOT NULL,
          billing_day INTEGER DEFAULT 5,
          deposit_amount REAL DEFAULT 0,
          billing_document_type TEXT CHECK(billing_document_type IN ('boleta', 'factura_exenta', 'factura_afecta')) DEFAULT 'boleta',
          notes TEXT,
          status TEXT CHECK(status IN ('active', 'suspended', 'terminated')) DEFAULT 'active',
          FOREIGN KEY(client_id) REFERENCES clients(id),
          FOREIGN KEY(space_id) REFERENCES spaces(id)
        );

        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id INTEGER,
          amount REAL NOT NULL,
          due_date DATE NOT NULL,
          payment_date DATETIME,
          status TEXT CHECK(status IN ('pending', 'paid', 'overdue', 'cancelled')) DEFAULT 'pending',
          method TEXT CHECK(method IN ('cash', 'transfer', 'card', 'automatic')),
          reference TEXT,
          receipt_file_path TEXT,
          receipt_file_name TEXT,
          receipt_mime_type TEXT,
          FOREIGN KEY(contract_id) REFERENCES contracts(id)
        );

        CREATE TABLE IF NOT EXISTS bank_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date DATE NOT NULL,
          description TEXT,
          rut TEXT,
          amount REAL NOT NULL,
          notes TEXT,
          status TEXT CHECK(status IN ('pending', 'reconciled', 'partial')) DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS payment_allocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL,
          bank_movement_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(payment_id) REFERENCES payments(id),
          FOREIGN KEY(bank_movement_id) REFERENCES bank_movements(id)
        );

        CREATE TABLE IF NOT EXISTS collection_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL,
          staff_id INTEGER,
          channel TEXT CHECK(channel IN ('phone', 'email', 'whatsapp', 'in_person', 'other')) NOT NULL,
          note TEXT NOT NULL,
          next_action_at DATE,
          status TEXT CHECK(status IN ('open', 'done')) DEFAULT 'open',
          completed_at DATETIME,
          completed_note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(payment_id) REFERENCES payments(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date DATE NOT NULL,
          category TEXT CHECK(category IN ('rent', 'maintenance', 'utilities', 'payroll', 'supplies', 'taxes', 'admin', 'other')) NOT NULL,
          supplier_name TEXT NOT NULL,
          supplier_rut TEXT,
          description TEXT NOT NULL,
          amount_net REAL NOT NULL DEFAULT 0,
          tax_amount REAL NOT NULL DEFAULT 0,
          amount_total REAL NOT NULL,
          document_type TEXT CHECK(document_type IN ('invoice', 'receipt', 'ticket', 'internal', 'none')) DEFAULT 'invoice',
          document_number TEXT,
          payment_method TEXT CHECK(payment_method IN ('cash', 'transfer', 'card', 'automatic', 'other')),
          payment_status TEXT CHECK(payment_status IN ('pending', 'paid', 'overdue', 'cancelled')) DEFAULT 'pending',
          paid_at DATE,
          due_date DATE,
          bank_movement_id INTEGER,
          receipt_file_path TEXT,
          receipt_file_name TEXT,
          receipt_mime_type TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(bank_movement_id) REFERENCES bank_movements(id)
        );

        CREATE TABLE IF NOT EXISTS invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folio INTEGER UNIQUE,
          type TEXT CHECK(type IN ('boleta', 'factura_exenta', 'factura_afecta')),
          client_id INTEGER,
          amount REAL NOT NULL,
          date DATETIME DEFAULT CURRENT_TIMESTAMP,
          status_sii TEXT CHECK(status_sii IN ('accepted', 'rejected', 'pending')) DEFAULT 'accepted',
          FOREIGN KEY(client_id) REFERENCES clients(id)
        );

        CREATE TABLE IF NOT EXISTS visitor_tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plate TEXT,
          entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          exit_time DATETIME,
          amount REAL DEFAULT 0,
          status TEXT CHECK(status IN ('active', 'paid', 'completed')) DEFAULT 'active',
          payment_method TEXT,
          space_id INTEGER REFERENCES spaces(id),
          created_by_staff_id INTEGER REFERENCES staff(id),
          entry_method TEXT DEFAULT 'manual'
        );

        CREATE TABLE IF NOT EXISTS access_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER,
          visitor_id INTEGER,
          space_id INTEGER,
          access_type TEXT CHECK(access_type IN ('entry', 'exit')) NOT NULL,
          status TEXT CHECK(status IN ('authorized', 'denied')) DEFAULT 'authorized',
          method TEXT CHECK(method IN ('fingerprint', 'card', 'qr', 'manual')) DEFAULT 'qr',
          reason TEXT,
          authorized_by TEXT,
          plate TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(client_id) REFERENCES clients(id),
          FOREIGN KEY(space_id) REFERENCES spaces(id)
        );

        CREATE TABLE IF NOT EXISTS visitor_passes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rut TEXT NOT NULL,
          type TEXT CHECK(type IN ('provider', 'family', 'maintenance', 'other')) NOT NULL,
          reason TEXT,
          associated_space_id INTEGER,
          valid_from DATETIME NOT NULL,
          valid_to DATETIME NOT NULL,
          qr_token TEXT UNIQUE NOT NULL,
          status TEXT CHECK(status IN ('waiting', 'inside', 'completed', 'expired')) DEFAULT 'waiting',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(associated_space_id) REFERENCES spaces(id)
        );

        CREATE TABLE IF NOT EXISTS access_rates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT UNIQUE NOT NULL,
          rate_per_hour REAL NOT NULL,
          rate_per_minute REAL,
          grace_period_mins INTEGER DEFAULT 15,
          billing_mode TEXT DEFAULT 'per_minute'
        );

        CREATE TABLE IF NOT EXISTS staff (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rut TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          role TEXT CHECK(role IN ('admin', 'finance', 'guard')) NOT NULL,
          status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
          password_hash TEXT,
          last_access DATETIME
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY,
          staff_id INTEGER NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS system_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          grace_days INTEGER DEFAULT 5,
          late_interest REAL DEFAULT 1.5,
          overdue_recovery_rate REAL DEFAULT 60,
          company_name TEXT,
          company_rut TEXT,
          company_address TEXT,
          sii_api_key TEXT,
          bank_api_key TEXT
        );

        CREATE TABLE IF NOT EXISTS totems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          status TEXT CHECK(status IN ('online', 'offline')) DEFAULT 'online',
          maintenance_mode BOOLEAN DEFAULT 0,
          last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vehicles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id INTEGER,
          plate TEXT UNIQUE NOT NULL,
          brand TEXT,
          model TEXT,
          color TEXT,
          FOREIGN KEY(client_id) REFERENCES clients(id)
        );

        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT CHECK(entity_type IN ('client', 'contract', 'payment')) NOT NULL,
          entity_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          document_type TEXT CHECK(document_type IN ('contract', 'identity', 'mandate', 'receipt', 'other')) DEFAULT 'other',
          status TEXT CHECK(status IN ('pending', 'received', 'approved', 'rejected', 'expired')) DEFAULT 'received',
          expires_at DATE,
          notes TEXT,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
  {
    id: "002_legacy_column_backfill",
    up: (db) => {
      addColumnIfMissing(db, "payments", "due_date", "DATE");
      addColumnIfMissing(db, "payments", "method", "TEXT");
      addColumnIfMissing(db, "spaces", "notes", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "space_id", "INTEGER REFERENCES spaces(id)");
      addColumnIfMissing(db, "access_logs", "visitor_id", "INTEGER");
      addColumnIfMissing(db, "access_logs", "status", "TEXT CHECK(status IN ('authorized', 'denied')) DEFAULT 'authorized'");
      addColumnIfMissing(db, "access_logs", "method", "TEXT CHECK(method IN ('fingerprint', 'card', 'qr', 'manual')) DEFAULT 'qr'");
      addColumnIfMissing(db, "access_logs", "reason", "TEXT");
      addColumnIfMissing(db, "access_logs", "authorized_by", "TEXT");
      addColumnIfMissing(db, "access_logs", "plate", "TEXT");
      addColumnIfMissing(db, "staff", "password_hash", "TEXT");
    },
  },
  {
    id: "003_audit_events",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          metadata TEXT,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
      `);
    },
  },
  {
    id: "004_operational_finance_fields",
    up: (db) => {
      addColumnIfMissing(db, "contracts", "deposit_amount", "REAL DEFAULT 0");
      addColumnIfMissing(db, "contracts", "billing_document_type", "TEXT CHECK(billing_document_type IN ('boleta', 'factura_exenta', 'factura_afecta')) DEFAULT 'boleta'");
      addColumnIfMissing(db, "contracts", "notes", "TEXT");
      addColumnIfMissing(db, "payments", "reference", "TEXT");
    },
  },
  {
    id: "005_payment_receipt_storage",
    up: (db) => {
      addColumnIfMissing(db, "payments", "receipt_file_path", "TEXT");
      addColumnIfMissing(db, "payments", "receipt_file_name", "TEXT");
      addColumnIfMissing(db, "payments", "receipt_mime_type", "TEXT");
    },
  },
  {
    id: "006_documents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT CHECK(entity_type IN ('client', 'contract', 'payment')) NOT NULL,
          entity_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
      `);
    },
  },
  {
    id: "007_document_tracking_fields",
    up: (db) => {
      addColumnIfMissing(db, "documents", "document_type", "TEXT CHECK(document_type IN ('contract', 'identity', 'mandate', 'receipt', 'other')) DEFAULT 'other'");
      addColumnIfMissing(db, "documents", "status", "TEXT CHECK(status IN ('pending', 'received', 'approved', 'rejected', 'expired')) DEFAULT 'received'");
      addColumnIfMissing(db, "documents", "expires_at", "DATE");
      addColumnIfMissing(db, "documents", "notes", "TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status, expires_at)");
    },
  },
  {
    id: "008_bank_movement_review_notes",
    up: (db) => {
      addColumnIfMissing(db, "bank_movements", "notes", "TEXT");
    },
  },
  {
    id: "009_payment_allocations",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_allocations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL,
          bank_movement_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(payment_id) REFERENCES payments(id),
          FOREIGN KEY(bank_movement_id) REFERENCES bank_movements(id)
        );

        CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
        CREATE INDEX IF NOT EXISTS idx_payment_allocations_movement ON payment_allocations(bank_movement_id);
      `);
    },
  },
  {
    id: "010_reversible_payment_allocations",
    up: (db) => {
      addColumnIfMissing(db, "payment_allocations", "reversed_at", "DATETIME");
      addColumnIfMissing(db, "payment_allocations", "reversed_note", "TEXT");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_payment
          ON payment_allocations(payment_id, reversed_at);
        CREATE INDEX IF NOT EXISTS idx_payment_allocations_active_movement
          ON payment_allocations(bank_movement_id, reversed_at);
      `);
    },
  },
  {
    id: "011_collection_actions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS collection_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL,
          staff_id INTEGER,
          channel TEXT CHECK(channel IN ('phone', 'email', 'whatsapp', 'in_person', 'other')) NOT NULL,
          note TEXT NOT NULL,
          next_action_at DATE,
          status TEXT CHECK(status IN ('open', 'done')) DEFAULT 'open',
          completed_at DATETIME,
          completed_note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(payment_id) REFERENCES payments(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_collection_actions_payment ON collection_actions(payment_id, status);
        CREATE INDEX IF NOT EXISTS idx_collection_actions_next ON collection_actions(status, next_action_at);
      `);
    },
  },
  {
    id: "012_expenses",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date DATE NOT NULL,
          category TEXT CHECK(category IN ('rent', 'maintenance', 'utilities', 'payroll', 'supplies', 'taxes', 'admin', 'other')) NOT NULL,
          supplier_name TEXT NOT NULL,
          supplier_rut TEXT,
          description TEXT NOT NULL,
          amount_net REAL NOT NULL DEFAULT 0,
          tax_amount REAL NOT NULL DEFAULT 0,
          amount_total REAL NOT NULL,
          document_type TEXT CHECK(document_type IN ('invoice', 'receipt', 'ticket', 'internal', 'none')) DEFAULT 'invoice',
          document_number TEXT,
          payment_method TEXT CHECK(payment_method IN ('cash', 'transfer', 'card', 'automatic', 'other')),
          payment_status TEXT CHECK(payment_status IN ('pending', 'paid', 'overdue', 'cancelled')) DEFAULT 'pending',
          paid_at DATE,
          due_date DATE,
          bank_movement_id INTEGER,
          receipt_file_path TEXT,
          receipt_file_name TEXT,
          receipt_mime_type TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(bank_movement_id) REFERENCES bank_movements(id)
        );

        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
        CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(payment_status, due_date);
        CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
      `);
    },
  },
  {
    id: "013_financial_budgets",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_budgets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          month TEXT NOT NULL,
          category TEXT CHECK(category IN ('rent', 'maintenance', 'utilities', 'payroll', 'supplies', 'taxes', 'admin', 'other')) NOT NULL,
          planned_amount REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(month, category)
        );

        CREATE INDEX IF NOT EXISTS idx_financial_budgets_month ON financial_budgets(month);
      `);
    },
  },
  {
    id: "014_overdue_recovery_rate",
    up: (db) => {
      addColumnIfMissing(db, "system_config", "overdue_recovery_rate", "REAL DEFAULT 60");
      db.prepare("UPDATE system_config SET overdue_recovery_rate = COALESCE(overdue_recovery_rate, 60) WHERE id = 1").run();
    },
  },
  {
    id: "015_operational_tasks",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operational_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT CHECK(category IN ('finance', 'access', 'documents', 'contracts', 'maintenance', 'general')) DEFAULT 'general',
          priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
          status TEXT CHECK(status IN ('open', 'in_progress', 'done', 'cancelled')) DEFAULT 'open',
          assigned_staff_id INTEGER,
          source_type TEXT,
          source_id TEXT,
          due_date DATE,
          completed_at DATETIME,
          completed_note TEXT,
          created_by_staff_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(assigned_staff_id) REFERENCES staff(id),
          FOREIGN KEY(created_by_staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_operational_tasks_status ON operational_tasks(status, due_date);
        CREATE INDEX IF NOT EXISTS idx_operational_tasks_assigned ON operational_tasks(assigned_staff_id, status);
        CREATE INDEX IF NOT EXISTS idx_operational_tasks_priority ON operational_tasks(priority, status);
      `);
    },
  },
  {
    id: "016_monthly_finance_closures",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS monthly_finance_closures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          month TEXT NOT NULL UNIQUE,
          status TEXT CHECK(status IN ('closed', 'reopened')) DEFAULT 'closed',
          closed_by_staff_id INTEGER,
          closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          accepted_pending_note TEXT,
          monthly_snapshot_json TEXT NOT NULL,
          operational_snapshot_json TEXT NOT NULL,
          reopened_by_staff_id INTEGER,
          reopened_at DATETIME,
          reopened_reason TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(closed_by_staff_id) REFERENCES staff(id),
          FOREIGN KEY(reopened_by_staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_monthly_finance_closures_status ON monthly_finance_closures(status, month);
      `);
    },
  },
  {
    id: "017_guard_shift_log",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guard_shift_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          shift_date DATE NOT NULL,
          shift_name TEXT CHECK(shift_name IN ('morning', 'afternoon', 'night', 'custom')) DEFAULT 'custom',
          opening_notes TEXT,
          handover_notes TEXT,
          cash_count_note TEXT,
          status TEXT CHECK(status IN ('open', 'closed')) DEFAULT 'open',
          opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS guard_shift_log_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_log_id INTEGER NOT NULL,
          staff_id INTEGER NOT NULL,
          task_id INTEGER,
          category TEXT CHECK(category IN ('access', 'visitor', 'incident', 'maintenance', 'payment', 'handover', 'other')) NOT NULL,
          priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
          title TEXT NOT NULL,
          detail TEXT,
          related_space_id INTEGER,
          related_access_log_id INTEGER,
          follow_up_required BOOLEAN DEFAULT 0,
          resolved_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(shift_log_id) REFERENCES guard_shift_logs(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id),
          FOREIGN KEY(task_id) REFERENCES operational_tasks(id),
          FOREIGN KEY(related_space_id) REFERENCES spaces(id),
          FOREIGN KEY(related_access_log_id) REFERENCES access_logs(id)
        );

        CREATE INDEX IF NOT EXISTS idx_guard_shift_logs_status ON guard_shift_logs(status, shift_date);
        CREATE INDEX IF NOT EXISTS idx_guard_shift_entries_shift ON guard_shift_log_entries(shift_log_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_guard_shift_entries_follow_up ON guard_shift_log_entries(follow_up_required, resolved_at);
      `);
    },
  },
  {
    id: "018_guard_shift_follow_up_tasks",
    up: (db) => {
      addColumnIfMissing(db, "guard_shift_log_entries", "task_id", "INTEGER REFERENCES operational_tasks(id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_guard_shift_entries_task ON guard_shift_log_entries(task_id)");
    },
  },
  {
    id: "019_client_master_data",
    up: (db) => {
      addColumnIfMissing(db, "clients", "status", "TEXT DEFAULT 'active'");
      addColumnIfMissing(db, "clients", "address", "TEXT");
      addColumnIfMissing(db, "clients", "commune", "TEXT");
      addColumnIfMissing(db, "clients", "city", "TEXT");
      addColumnIfMissing(db, "clients", "business_activity", "TEXT");
      addColumnIfMissing(db, "clients", "legal_representative_name", "TEXT");
      addColumnIfMissing(db, "clients", "legal_representative_rut", "TEXT");
      addColumnIfMissing(db, "clients", "billing_contact_name", "TEXT");
      addColumnIfMissing(db, "clients", "billing_contact_email", "TEXT");
      addColumnIfMissing(db, "clients", "billing_contact_phone", "TEXT");
      addColumnIfMissing(db, "clients", "notes", "TEXT");
      addColumnIfMissing(db, "vehicles", "notes", "TEXT");

      db.prepare("UPDATE clients SET status = COALESCE(status, 'active')").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles(client_id)");
    },
  },
  {
    id: "020_staff_security_controls",
    up: (db) => {
      addColumnIfMissing(db, "staff", "must_change_password", "BOOLEAN DEFAULT 0");
      addColumnIfMissing(db, "staff", "password_changed_at", "DATETIME");
      addColumnIfMissing(db, "staff", "updated_at", "DATETIME");
      db.prepare("UPDATE staff SET updated_at = COALESCE(updated_at, datetime('now'))").run();

      db.exec(`
        CREATE TABLE IF NOT EXISTS staff_access_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER NOT NULL,
          event_type TEXT CHECK(event_type IN ('login', 'logout', 'password_changed', 'password_reset', 'status_changed', 'profile_updated', 'role_changed')) NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_staff_access_events_staff ON staff_access_events(staff_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_staff_access_events_created ON staff_access_events(created_at);
      `);
    },
  },
  {
    id: "021_document_task_follow_up",
    up: (db) => {
      addColumnIfMissing(db, "documents", "assigned_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "documents", "next_action_at", "DATE");
      addColumnIfMissing(db, "documents", "reviewed_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "documents", "reviewed_at", "DATETIME");
      addColumnIfMissing(db, "documents", "rejection_reason", "TEXT");

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          staff_id INTEGER,
          note TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(task_id) REFERENCES operational_tasks(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS task_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          comment_id INTEGER,
          staff_id INTEGER,
          label TEXT,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(task_id) REFERENCES operational_tasks(id),
          FOREIGN KEY(comment_id) REFERENCES task_comments(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_documents_follow_up ON documents(status, next_action_at, assigned_staff_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at);
      `);
    },
  },
  {
    id: "022_physical_operations",
    up: (db) => {
      addColumnIfMissing(db, "spaces", "location", "TEXT");
      addColumnIfMissing(db, "spaces", "level", "TEXT");
      addColumnIfMissing(db, "spaces", "width_m", "REAL");
      addColumnIfMissing(db, "spaces", "length_m", "REAL");
      addColumnIfMissing(db, "spaces", "height_m", "REAL");
      addColumnIfMissing(db, "spaces", "features", "TEXT");
      addColumnIfMissing(db, "spaces", "updated_at", "DATETIME");
      db.prepare("UPDATE spaces SET updated_at = COALESCE(updated_at, datetime('now'))").run();

      addColumnIfMissing(db, "visitor_passes", "plate", "TEXT");
      addColumnIfMissing(db, "visitor_passes", "phone", "TEXT");
      addColumnIfMissing(db, "visitor_passes", "company", "TEXT");
      addColumnIfMissing(db, "visitor_passes", "authorized_by", "TEXT");

      db.exec(`
        CREATE TABLE IF NOT EXISTS space_status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL,
          staff_id INTEGER,
          previous_status TEXT,
          status TEXT NOT NULL,
          reason TEXT,
          source TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(space_id) REFERENCES spaces(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS shift_log_entry_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_log_entry_id INTEGER NOT NULL,
          staff_id INTEGER,
          label TEXT,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(shift_log_entry_id) REFERENCES guard_shift_log_entries(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_space_status_history_space ON space_status_history(space_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_shift_entry_attachments_entry ON shift_log_entry_attachments(shift_log_entry_id, created_at);
      `);
    },
  },
  {
    id: "023_finance_control_real",
    up: (db) => {
      addColumnIfMissing(db, "expenses", "cost_center", "TEXT DEFAULT 'general'");
      addColumnIfMissing(db, "expenses", "approval_status", "TEXT DEFAULT 'pending'");
      addColumnIfMissing(db, "expenses", "approved_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "expenses", "approved_at", "DATETIME");
      addColumnIfMissing(db, "expenses", "approval_note", "TEXT");
      db.prepare("UPDATE expenses SET cost_center = COALESCE(cost_center, 'general'), approval_status = COALESCE(approval_status, 'pending')").run();

      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payment_id INTEGER NOT NULL,
          staff_id INTEGER,
          type TEXT CHECK(type IN ('discount', 'waiver', 'fee')) NOT NULL,
          amount REAL NOT NULL,
          previous_amount REAL NOT NULL,
          new_amount REAL NOT NULL,
          reason TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(payment_id) REFERENCES payments(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_payment_adjustments_payment ON payment_adjustments(payment_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_expenses_cost_center ON expenses(cost_center, date);
        CREATE INDEX IF NOT EXISTS idx_expenses_approval ON expenses(approval_status, date);
      `);
    },
  },
  {
    id: "024_access_denial_resolution",
    up: (db) => {
      addColumnIfMissing(db, "access_logs", "resolved_by_access_log_id", "INTEGER REFERENCES access_logs(id)");
      addColumnIfMissing(db, "access_logs", "resolved_at", "DATETIME");
      addColumnIfMissing(db, "access_logs", "resolution_note", "TEXT");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_access_logs_resolution ON access_logs(status, resolved_at);
        CREATE INDEX IF NOT EXISTS idx_access_logs_resolved_by ON access_logs(resolved_by_access_log_id);
      `);
    },
  },
  {
    id: "025_sii_provider_layer",
    up: (db) => {
      addColumnIfMissing(db, "system_config", "sii_provider", "TEXT DEFAULT 'local_mock'");
      addColumnIfMissing(db, "system_config", "sii_mode", "TEXT DEFAULT 'mock'");
      addColumnIfMissing(db, "system_config", "sii_environment", "TEXT DEFAULT 'demo'");
      db.prepare(`
        UPDATE system_config
        SET sii_provider = COALESCE(sii_provider, 'local_mock'),
            sii_mode = COALESCE(sii_mode, 'mock'),
            sii_environment = COALESCE(sii_environment, 'demo')
        WHERE id = 1
      `).run();

      addColumnIfMissing(db, "invoices", "payment_id", "INTEGER REFERENCES payments(id)");
      addColumnIfMissing(db, "invoices", "contract_id", "INTEGER REFERENCES contracts(id)");
      addColumnIfMissing(db, "invoices", "provider", "TEXT DEFAULT 'local_mock'");
      addColumnIfMissing(db, "invoices", "provider_mode", "TEXT DEFAULT 'mock'");
      addColumnIfMissing(db, "invoices", "external_id", "TEXT");
      addColumnIfMissing(db, "invoices", "track_id", "TEXT");
      addColumnIfMissing(db, "invoices", "status_detail", "TEXT");
      addColumnIfMissing(db, "invoices", "rejection_reason", "TEXT");
      addColumnIfMissing(db, "invoices", "validation_errors_json", "TEXT");
      addColumnIfMissing(db, "invoices", "sii_payload_json", "TEXT");
      addColumnIfMissing(db, "invoices", "sii_response_json", "TEXT");
      addColumnIfMissing(db, "invoices", "pdf_content", "TEXT");
      addColumnIfMissing(db, "invoices", "xml_content", "TEXT");
      addColumnIfMissing(db, "invoices", "issued_at", "DATETIME");
      addColumnIfMissing(db, "invoices", "accepted_at", "DATETIME");
      addColumnIfMissing(db, "invoices", "rejected_at", "DATETIME");
      addColumnIfMissing(db, "invoices", "last_sync_at", "DATETIME");
      addColumnIfMissing(db, "invoices", "updated_at", "DATETIME");

      db.exec(`
        CREATE TABLE IF NOT EXISTS sii_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL,
          staff_id INTEGER,
          provider TEXT NOT NULL,
          event_type TEXT CHECK(event_type IN ('prepared', 'issued', 'synced', 'rejected', 'downloaded')) NOT NULL,
          status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) NOT NULL,
          payload_json TEXT,
          response_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(invoice_id) REFERENCES invoices(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices(contract_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_status_sii ON invoices(status_sii, date);
        CREATE INDEX IF NOT EXISTS idx_invoices_track_id ON invoices(track_id);
        CREATE INDEX IF NOT EXISTS idx_sii_events_invoice ON sii_events(invoice_id, created_at);
      `);
    },
  },
  {
    id: "026_default_access_rates",
    up: (db) => {
      const rateCount = db.prepare("SELECT COUNT(*) as count FROM access_rates").get() as { count: number };
      if (rateCount.count !== 0) return;

      const insertRate = db.prepare("INSERT INTO access_rates (type, rate_per_hour, grace_period_mins) VALUES (?, ?, ?)");
      insertRate.run("Proveedor", 0, 120);
      insertRate.run("Visita Cliente", 1500, 15);
      insertRate.run("Público General", 2500, 15);
    },
  },
  {
    id: "027_vehicle_soft_delete",
    up: (db) => {
      addColumnIfMissing(db, "vehicles", "status", "TEXT DEFAULT 'active'");
      addColumnIfMissing(db, "vehicles", "archived_at", "DATETIME");
      addColumnIfMissing(db, "vehicles", "archive_reason", "TEXT");
      db.prepare("UPDATE vehicles SET status = COALESCE(status, 'active')").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_vehicles_status_client ON vehicles(status, client_id)");
    },
  },
  {
    id: "028_visitor_ticket_payment_timestamp",
    up: (db) => {
      addColumnIfMissing(db, "visitor_tickets", "paid_at", "DATETIME");
      db.prepare(`
        UPDATE visitor_tickets
        SET paid_at = COALESCE(paid_at, exit_time, entry_time)
        WHERE amount > 0
          AND payment_method IS NOT NULL
      `).run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_visitor_tickets_paid_at ON visitor_tickets(paid_at)");
    },
  },
  {
    id: "029_visitor_ticket_quotes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS visitor_ticket_quotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL,
          rate_id INTEGER,
          rate_label TEXT NOT NULL,
          rate_per_hour REAL NOT NULL DEFAULT 0,
          rate_per_minute REAL NOT NULL DEFAULT 0,
          billing_mode TEXT NOT NULL DEFAULT 'per_minute',
          grace_period_mins INTEGER NOT NULL DEFAULT 0,
          entry_time DATETIME NOT NULL,
          quote_time DATETIME NOT NULL,
          duration_mins INTEGER NOT NULL DEFAULT 0,
          billable_mins INTEGER NOT NULL DEFAULT 0,
          subtotal REAL NOT NULL DEFAULT 0,
          discount_amount REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          rounding_increment INTEGER NOT NULL DEFAULT 100,
          expires_at DATETIME,
          status TEXT CHECK(status IN ('quoted', 'used', 'expired', 'void')) DEFAULT 'quoted',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(ticket_id) REFERENCES visitor_tickets(id),
          FOREIGN KEY(rate_id) REFERENCES access_rates(id)
        );

        CREATE INDEX IF NOT EXISTS idx_visitor_ticket_quotes_ticket ON visitor_ticket_quotes(ticket_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_visitor_ticket_quotes_status ON visitor_ticket_quotes(status, expires_at);
      `);

      addColumnIfMissing(db, "visitor_tickets", "quote_id", "INTEGER REFERENCES visitor_ticket_quotes(id)");
      addColumnIfMissing(db, "visitor_tickets", "paid_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "visitor_tickets", "completed_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "visitor_tickets", "created_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "visitor_tickets", "entry_method", "TEXT DEFAULT 'manual'");
      addColumnIfMissing(db, "visitor_tickets", "payment_override_reason", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "quoted_amount", "REAL");
      addColumnIfMissing(db, "visitor_ticket_quotes", "rate_per_minute", "REAL NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "visitor_ticket_quotes", "billing_mode", "TEXT NOT NULL DEFAULT 'per_minute'");
      db.exec("CREATE INDEX IF NOT EXISTS idx_visitor_tickets_status_space ON visitor_tickets(status, space_id)");
    },
  },
  {
    id: "030_operational_cash_sessions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cash_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id INTEGER,
          shift_log_id INTEGER,
          status TEXT CHECK(status IN ('open', 'closed')) DEFAULT 'open',
          opening_cash REAL NOT NULL DEFAULT 0,
          expected_cash REAL NOT NULL DEFAULT 0,
          counted_cash REAL,
          counted_transfer REAL,
          counted_card REAL,
          difference_cash REAL,
          opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          closed_at DATETIME,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(staff_id) REFERENCES staff(id),
          FOREIGN KEY(shift_log_id) REFERENCES guard_shift_logs(id)
        );

        CREATE TABLE IF NOT EXISTS cash_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cash_session_id INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          method TEXT CHECK(method IN ('cash', 'transfer', 'card', 'automatic', 'other')) NOT NULL,
          direction TEXT CHECK(direction IN ('in', 'out')) NOT NULL DEFAULT 'in',
          amount REAL NOT NULL,
          created_by_staff_id INTEGER,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id),
          FOREIGN KEY(created_by_staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS cash_session_closures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cash_session_id INTEGER NOT NULL,
          closed_by_staff_id INTEGER,
          snapshot_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id),
          FOREIGN KEY(closed_by_staff_id) REFERENCES staff(id)
        );

        CREATE INDEX IF NOT EXISTS idx_cash_sessions_status_staff ON cash_sessions(status, staff_id);
        CREATE INDEX IF NOT EXISTS idx_cash_sessions_shift ON cash_sessions(shift_log_id);
        CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_unique_source
          ON cash_movements(source_type, source_id, direction)
          WHERE direction = 'in';
      `);

      addColumnIfMissing(db, "visitor_tickets", "cash_session_id", "INTEGER REFERENCES cash_sessions(id)");
      addColumnIfMissing(db, "visitor_tickets", "receipt_file_path", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "receipt_file_name", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "receipt_mime_type", "TEXT");
      addColumnIfMissing(db, "guard_shift_logs", "cash_session_id", "INTEGER REFERENCES cash_sessions(id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_visitor_tickets_cash_session ON visitor_tickets(cash_session_id)");
    },
  },
  {
    id: "031_minute_billing_and_manual_tickets",
    up: (db) => {
      addColumnIfMissing(db, "access_rates", "rate_per_minute", "REAL");
      addColumnIfMissing(db, "access_rates", "billing_mode", "TEXT DEFAULT 'per_minute'");
      addColumnIfMissing(db, "visitor_ticket_quotes", "rate_per_minute", "REAL NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "visitor_ticket_quotes", "billing_mode", "TEXT NOT NULL DEFAULT 'per_minute'");
      addColumnIfMissing(db, "visitor_tickets", "created_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "visitor_tickets", "entry_method", "TEXT DEFAULT 'manual'");
      db.prepare(`
        UPDATE access_rates
        SET rate_per_minute = CASE
              WHEN COALESCE(rate_per_minute, 0) > 0 THEN rate_per_minute
              ELSE CAST(rate_per_hour / 60 AS INTEGER)
            END,
            billing_mode = 'per_minute'
      `).run();
      db.prepare(`
        UPDATE access_rates
        SET rate_per_hour = rate_per_minute * 60
        WHERE COALESCE(rate_per_minute, 0) > 0
      `).run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_visitor_tickets_entry_method ON visitor_tickets(entry_method, entry_time)");
    },
  },
  {
    id: "032_cashier_role",
    transaction: false,
    up: (db) => {
      db.pragma("foreign_keys = OFF");
      db.exec("DROP TABLE IF EXISTS staff_role_migration_tmp");
      db.exec(`
        CREATE TABLE staff_role_migration_tmp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rut TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          role TEXT CHECK(role IN ('admin', 'finance', 'guard', 'cashier')) NOT NULL,
          status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
          password_hash TEXT,
          last_access DATETIME,
          must_change_password BOOLEAN DEFAULT 0,
          password_changed_at DATETIME,
          updated_at DATETIME
        );
      `);
      db.exec(`
        INSERT INTO staff_role_migration_tmp (
          id, name, rut, email, phone, role, status, password_hash, last_access,
          must_change_password, password_changed_at, updated_at
        )
        SELECT id, name, rut, email, phone, role, status, password_hash, last_access,
               COALESCE(must_change_password, 0), password_changed_at, updated_at
        FROM staff;
      `);
      db.exec("DROP TABLE staff");
      db.exec("ALTER TABLE staff_role_migration_tmp RENAME TO staff");
      db.exec("CREATE INDEX IF NOT EXISTS idx_staff_role_status ON staff(role, status)");
      db.pragma("foreign_keys = ON");
    },
  },
  {
    id: "033_branch_foundation",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS branches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          address TEXT,
          commune TEXT,
          city TEXT,
          phone TEXT,
          status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_branches_status ON branches(status, name);
      `);

      const branchCount = db.prepare("SELECT COUNT(*) as count FROM branches").get() as { count: number };
      if (branchCount.count === 0) {
        db.prepare(`
          INSERT INTO branches (name, code, address, commune, city, status)
          VALUES ('Sucursal Principal', 'MAIN', 'Pendiente de configurar', 'Santiago', 'Santiago', 'active')
        `).run();
      }

      const defaultBranch = db.prepare("SELECT id FROM branches ORDER BY id ASC LIMIT 1").get() as { id: number };
      const branchId = defaultBranch.id;

      for (const table of [
        "spaces",
        "contracts",
        "payments",
        "expenses",
        "visitor_tickets",
        "access_logs",
        "visitor_passes",
        "totems",
        "guard_shift_logs",
        "operational_tasks",
        "cash_sessions",
      ]) {
        addColumnIfMissing(db, table, "branch_id", "INTEGER REFERENCES branches(id)");
      }

      for (const table of [
        "spaces",
        "expenses",
        "visitor_tickets",
        "access_logs",
        "visitor_passes",
        "totems",
        "guard_shift_logs",
        "operational_tasks",
        "cash_sessions",
      ]) {
        if (tableExists(db, table) && columnExists(db, table, "branch_id")) {
          db.prepare(`UPDATE ${table} SET branch_id = COALESCE(branch_id, ?)`).run(branchId);
        }
      }

      if (tableExists(db, "contracts") && columnExists(db, "contracts", "branch_id")) {
        db.prepare(`
          UPDATE contracts
          SET branch_id = COALESCE(
            branch_id,
            (SELECT branch_id FROM spaces WHERE spaces.id = contracts.space_id),
            ?
          )
        `).run(branchId);
      }

      if (tableExists(db, "payments") && columnExists(db, "payments", "branch_id")) {
        db.prepare(`
          UPDATE payments
          SET branch_id = COALESCE(
            branch_id,
            (SELECT branch_id FROM contracts WHERE contracts.id = payments.contract_id),
            ?
          )
        `).run(branchId);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_spaces_branch_status ON spaces(branch_id, status, type);
        CREATE INDEX IF NOT EXISTS idx_contracts_branch_status ON contracts(branch_id, status);
        CREATE INDEX IF NOT EXISTS idx_payments_branch_status ON payments(branch_id, status, due_date);
        CREATE INDEX IF NOT EXISTS idx_visitor_tickets_branch_status ON visitor_tickets(branch_id, status, entry_time);
        CREATE INDEX IF NOT EXISTS idx_access_logs_branch_time ON access_logs(branch_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_cash_sessions_branch_status ON cash_sessions(branch_id, status, opened_at);
      `);
    },
  },
  {
    id: "034_saas_tenant_foundation",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          rut TEXT,
          status TEXT CHECK(status IN ('active', 'suspended', 'archived')) DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          max_branches INTEGER,
          max_spaces INTEGER,
          max_users INTEGER,
          monthly_ticket_limit INTEGER,
          price_clp INTEGER DEFAULT 0,
          status TEXT CHECK(status IN ('active', 'archived')) DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_memberships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          staff_id INTEGER NOT NULL,
          role TEXT CHECK(role IN ('owner', 'admin', 'member')) DEFAULT 'member',
          status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, staff_id),
          FOREIGN KEY(tenant_id) REFERENCES tenants(id),
          FOREIGN KEY(staff_id) REFERENCES staff(id)
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          plan_id INTEGER NOT NULL,
          status TEXT CHECK(status IN ('trialing', 'active', 'past_due', 'suspended', 'cancelled')) DEFAULT 'trialing',
          current_period_start DATE,
          current_period_end DATE,
          cancelled_at DATETIME,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(tenant_id) REFERENCES tenants(id),
          FOREIGN KEY(plan_id) REFERENCES plans(id)
        );

        CREATE INDEX IF NOT EXISTS idx_tenant_memberships_staff ON tenant_memberships(staff_id, status);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON subscriptions(tenant_id, status, current_period_end);
      `);

      const planCount = db.prepare("SELECT COUNT(*) as count FROM plans").get() as { count: number };
      if (planCount.count === 0) {
        const insertPlan = db.prepare(`
          INSERT INTO plans (code, name, max_branches, max_spaces, max_users, monthly_ticket_limit, price_clp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertPlan.run("starter", "Starter", 1, 40, 3, 5000, 29900);
        insertPlan.run("pro", "Pro", 3, 150, 15, 20000, 79900);
        insertPlan.run("business", "Business", null, null, null, null, 149900);
      }

      const tenantCount = db.prepare("SELECT COUNT(*) as count FROM tenants").get() as { count: number };
      if (tenantCount.count === 0) {
        const company = tableExists(db, "system_config")
          ? db.prepare("SELECT company_name, company_rut FROM system_config WHERE id = 1").get() as { company_name?: string, company_rut?: string } | undefined
          : undefined;
        db.prepare("INSERT INTO tenants (name, rut, status) VALUES (?, ?, 'active')")
          .run(company?.company_name || "Parkia Demo", company?.company_rut || null);
      }

      const defaultTenant = db.prepare("SELECT id FROM tenants ORDER BY id ASC LIMIT 1").get() as { id: number };
      const tenantId = defaultTenant.id;
      const proPlan = db.prepare("SELECT id FROM plans WHERE code = 'pro'").get() as { id: number };

      const activeSubscription = db.prepare("SELECT id FROM subscriptions WHERE tenant_id = ? AND status IN ('trialing', 'active') LIMIT 1").get(tenantId);
      if (!activeSubscription) {
        db.prepare(`
          INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, notes)
          VALUES (?, ?, 'active', date('now', 'start of month'), date('now', '+1 year'), 'Suscripcion default creada por migracion SaaS')
        `).run(tenantId, proPlan.id);
      }

      db.prepare(`
        INSERT OR IGNORE INTO tenant_memberships (tenant_id, staff_id, role, status)
        SELECT ?, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, 'active'
        FROM staff
      `).run(tenantId);

      for (const table of [
        "branches",
        "clients",
        "spaces",
        "contracts",
        "payments",
        "bank_movements",
        "payment_allocations",
        "collection_actions",
        "expenses",
        "invoices",
        "visitor_tickets",
        "visitor_passes",
        "visitor_ticket_quotes",
        "access_logs",
        "totems",
        "access_rates",
        "guard_shift_logs",
        "guard_shift_log_entries",
        "cash_sessions",
        "cash_movements",
        "cash_session_closures",
        "operational_tasks",
        "documents",
        "audit_events",
      ]) {
        addColumnIfMissing(db, table, "tenant_id", "INTEGER REFERENCES tenants(id)");
        if (tableExists(db, table) && columnExists(db, table, "tenant_id")) {
          db.prepare(`UPDATE ${table} SET tenant_id = COALESCE(tenant_id, ?)`).run(tenantId);
          db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
          db.exec(`
            CREATE TRIGGER IF NOT EXISTS trg_${table}_tenant_default
            AFTER INSERT ON ${table}
            WHEN NEW.tenant_id IS NULL
            BEGIN
              UPDATE ${table} SET tenant_id = ${tenantId} WHERE id = NEW.id;
            END;
          `);
        }
      }
    },
  },
  {
    id: "035_remove_storage_space_domain",
    up: (db) => {
      db.prepare(`
        UPDATE spaces
        SET status = 'maintenance',
            notes = trim(COALESCE(notes || char(10), '') || 'Legacy storage space archived during Parkia parking-only migration.'),
            updated_at = datetime('now')
        WHERE type = 'storage'
      `).run();
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_spaces_block_storage_insert
        BEFORE INSERT ON spaces
        WHEN NEW.type != 'parking'
        BEGIN
          SELECT RAISE(ABORT, 'Solo se permiten estacionamientos');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_spaces_block_storage_type_update
        BEFORE UPDATE OF type ON spaces
        WHEN NEW.type != 'parking'
        BEGIN
          SELECT RAISE(ABORT, 'Solo se permiten estacionamientos');
        END;
      `);
    },
  },
  {
    id: "036_bank_movements_branch_scope",
    up: (db) => {
      addColumnIfMissing(db, "bank_movements", "branch_id", "INTEGER REFERENCES branches(id)");
      if (tableExists(db, "bank_movements") && columnExists(db, "bank_movements", "branch_id")) {
        const branch = db.prepare("SELECT id FROM branches ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
        if (branch) {
          db.prepare("UPDATE bank_movements SET branch_id = COALESCE(branch_id, ?)").run(branch.id);
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_bank_movements_branch_status ON bank_movements(branch_id, status, date)");
      }
      addColumnIfMissing(db, "vehicles", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (tableExists(db, "vehicles") && columnExists(db, "vehicles", "tenant_id")) {
        db.prepare(`
          UPDATE vehicles
          SET tenant_id = COALESCE(
            tenant_id,
            (SELECT tenant_id FROM clients WHERE clients.id = vehicles.client_id),
            (SELECT id FROM tenants ORDER BY id ASC LIMIT 1)
          )
        `).run();
        db.exec("CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_plate ON vehicles(tenant_id, plate)");
      }
      for (const table of ["space_status_history", "sii_events"]) {
        addColumnIfMissing(db, table, "tenant_id", "INTEGER REFERENCES tenants(id)");
        if (tableExists(db, table) && columnExists(db, table, "tenant_id")) {
          db.prepare(`UPDATE ${table} SET tenant_id = COALESCE(tenant_id, (SELECT id FROM tenants ORDER BY id ASC LIMIT 1))`).run();
          db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
          db.exec(`
            CREATE TRIGGER IF NOT EXISTS trg_${table}_tenant_default
            AFTER INSERT ON ${table}
            WHEN NEW.tenant_id IS NULL
            BEGIN
              UPDATE ${table} SET tenant_id = (SELECT id FROM tenants ORDER BY id ASC LIMIT 1) WHERE id = NEW.id;
            END;
          `);
        }
      }
      addColumnIfMissing(db, "tenant_memberships", "updated_at", "DATETIME");
    },
  },
  {
    id: "037_multitenant_finance_children",
    up: (db) => {
      const defaultTenant = db.prepare("SELECT id FROM tenants ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
      if (!defaultTenant) return;
      const tenantId = defaultTenant.id;

      if (tableExists(db, "financial_budgets")) {
        addColumnIfMissing(db, "financial_budgets", "tenant_id", "INTEGER REFERENCES tenants(id)");
        db.prepare("UPDATE financial_budgets SET tenant_id = COALESCE(tenant_id, ?)").run(tenantId);
        db.exec(`
          DROP TABLE IF EXISTS financial_budgets_tenant_tmp;

          CREATE TABLE financial_budgets_tenant_tmp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            category TEXT CHECK(category IN ('rent', 'maintenance', 'utilities', 'payroll', 'supplies', 'taxes', 'admin', 'other')) NOT NULL,
            planned_amount REAL NOT NULL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            tenant_id INTEGER NOT NULL,
            UNIQUE(tenant_id, month, category),
            FOREIGN KEY(tenant_id) REFERENCES tenants(id)
          );

          INSERT OR IGNORE INTO financial_budgets_tenant_tmp (
            id, month, category, planned_amount, notes, created_at, updated_at, tenant_id
          )
          SELECT id, month, category, planned_amount, notes, created_at, updated_at, COALESCE(tenant_id, ${tenantId})
          FROM financial_budgets;

          DROP TABLE financial_budgets;
          ALTER TABLE financial_budgets_tenant_tmp RENAME TO financial_budgets;

          CREATE INDEX IF NOT EXISTS idx_financial_budgets_month ON financial_budgets(month);
          CREATE INDEX IF NOT EXISTS idx_financial_budgets_tenant_month ON financial_budgets(tenant_id, month);
          CREATE TRIGGER IF NOT EXISTS trg_financial_budgets_tenant_default
          AFTER INSERT ON financial_budgets
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE financial_budgets SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }

      if (tableExists(db, "monthly_finance_closures")) {
        addColumnIfMissing(db, "monthly_finance_closures", "tenant_id", "INTEGER REFERENCES tenants(id)");
        db.prepare("UPDATE monthly_finance_closures SET tenant_id = COALESCE(tenant_id, ?)").run(tenantId);
        db.exec(`
          DROP TABLE IF EXISTS monthly_finance_closures_tenant_tmp;

          CREATE TABLE monthly_finance_closures_tenant_tmp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month TEXT NOT NULL,
            status TEXT CHECK(status IN ('closed', 'reopened')) DEFAULT 'closed',
            closed_by_staff_id INTEGER,
            closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            accepted_pending_note TEXT,
            monthly_snapshot_json TEXT NOT NULL,
            operational_snapshot_json TEXT NOT NULL,
            reopened_by_staff_id INTEGER,
            reopened_at DATETIME,
            reopened_reason TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            tenant_id INTEGER NOT NULL,
            UNIQUE(tenant_id, month),
            FOREIGN KEY(closed_by_staff_id) REFERENCES staff(id),
            FOREIGN KEY(reopened_by_staff_id) REFERENCES staff(id),
            FOREIGN KEY(tenant_id) REFERENCES tenants(id)
          );

          INSERT OR IGNORE INTO monthly_finance_closures_tenant_tmp (
            id, month, status, closed_by_staff_id, closed_at, accepted_pending_note,
            monthly_snapshot_json, operational_snapshot_json, reopened_by_staff_id,
            reopened_at, reopened_reason, updated_at, tenant_id
          )
          SELECT id, month, status, closed_by_staff_id, closed_at, accepted_pending_note,
                 monthly_snapshot_json, operational_snapshot_json, reopened_by_staff_id,
                 reopened_at, reopened_reason, updated_at, COALESCE(tenant_id, ${tenantId})
          FROM monthly_finance_closures;

          DROP TABLE monthly_finance_closures;
          ALTER TABLE monthly_finance_closures_tenant_tmp RENAME TO monthly_finance_closures;

          CREATE INDEX IF NOT EXISTS idx_monthly_finance_closures_status ON monthly_finance_closures(status, month);
          CREATE INDEX IF NOT EXISTS idx_monthly_finance_closures_tenant_month ON monthly_finance_closures(tenant_id, month);
          CREATE TRIGGER IF NOT EXISTS trg_monthly_finance_closures_tenant_default
          AFTER INSERT ON monthly_finance_closures
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE monthly_finance_closures SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }

      addColumnIfMissing(db, "payment_adjustments", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (tableExists(db, "payment_adjustments") && columnExists(db, "payment_adjustments", "tenant_id")) {
        db.prepare(`
          UPDATE payment_adjustments
          SET tenant_id = COALESCE(
            tenant_id,
            (SELECT tenant_id FROM payments WHERE payments.id = payment_adjustments.payment_id),
            ?
          )
        `).run(tenantId);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_payment_adjustments_tenant_payment ON payment_adjustments(tenant_id, payment_id, created_at);
          CREATE TRIGGER IF NOT EXISTS trg_payment_adjustments_tenant_default
          AFTER INSERT ON payment_adjustments
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE payment_adjustments SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }

      addColumnIfMissing(db, "task_comments", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (tableExists(db, "task_comments") && columnExists(db, "task_comments", "tenant_id")) {
        db.prepare(`
          UPDATE task_comments
          SET tenant_id = COALESCE(
            tenant_id,
            (SELECT tenant_id FROM operational_tasks WHERE operational_tasks.id = task_comments.task_id),
            ?
          )
        `).run(tenantId);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_task_comments_tenant_task ON task_comments(tenant_id, task_id, created_at);
          CREATE TRIGGER IF NOT EXISTS trg_task_comments_tenant_default
          AFTER INSERT ON task_comments
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE task_comments SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }

      addColumnIfMissing(db, "task_attachments", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (tableExists(db, "task_attachments") && columnExists(db, "task_attachments", "tenant_id")) {
        db.prepare(`
          UPDATE task_attachments
          SET tenant_id = COALESCE(
            tenant_id,
            (SELECT tenant_id FROM task_comments WHERE task_comments.id = task_attachments.comment_id),
            (SELECT tenant_id FROM operational_tasks WHERE operational_tasks.id = task_attachments.task_id),
            ?
          )
        `).run(tenantId);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_task_attachments_tenant_task ON task_attachments(tenant_id, task_id, created_at);
          CREATE TRIGGER IF NOT EXISTS trg_task_attachments_tenant_default
          AFTER INSERT ON task_attachments
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE task_attachments SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }

      addColumnIfMissing(db, "shift_log_entry_attachments", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (tableExists(db, "shift_log_entry_attachments") && columnExists(db, "shift_log_entry_attachments", "tenant_id")) {
        db.prepare(`
          UPDATE shift_log_entry_attachments
          SET tenant_id = COALESCE(
            tenant_id,
            (SELECT tenant_id FROM guard_shift_log_entries WHERE guard_shift_log_entries.id = shift_log_entry_attachments.shift_log_entry_id),
            ?
          )
        `).run(tenantId);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_shift_entry_attachments_tenant_entry ON shift_log_entry_attachments(tenant_id, shift_log_entry_id, created_at);
          CREATE TRIGGER IF NOT EXISTS trg_shift_log_entry_attachments_tenant_default
          AFTER INSERT ON shift_log_entry_attachments
          WHEN NEW.tenant_id IS NULL
          BEGIN
            UPDATE shift_log_entry_attachments SET tenant_id = ${tenantId} WHERE id = NEW.id;
          END;
        `);
      }
    },
  },
  {
    id: "038_space_maps",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS space_maps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          branch_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          image_file_path TEXT NOT NULL,
          image_file_name TEXT NOT NULL,
          image_mime_type TEXT NOT NULL,
          image_width INTEGER NOT NULL,
          image_height INTEGER NOT NULL,
          status TEXT CHECK(status IN ('active', 'archived')) DEFAULT 'active',
          is_default BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, branch_id, name),
          FOREIGN KEY(tenant_id) REFERENCES tenants(id),
          FOREIGN KEY(branch_id) REFERENCES branches(id)
        );

        CREATE TABLE IF NOT EXISTS space_map_regions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          map_id INTEGER NOT NULL,
          space_id INTEGER NOT NULL,
          geometry_json TEXT NOT NULL,
          label TEXT,
          color TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, map_id, space_id),
          FOREIGN KEY(tenant_id) REFERENCES tenants(id),
          FOREIGN KEY(map_id) REFERENCES space_maps(id) ON DELETE CASCADE,
          FOREIGN KEY(space_id) REFERENCES spaces(id)
        );

        CREATE INDEX IF NOT EXISTS idx_space_maps_tenant_branch ON space_maps(tenant_id, branch_id, status);
        CREATE INDEX IF NOT EXISTS idx_space_maps_default ON space_maps(tenant_id, branch_id, is_default);
        CREATE INDEX IF NOT EXISTS idx_space_map_regions_map ON space_map_regions(tenant_id, map_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_space_map_regions_space ON space_map_regions(tenant_id, space_id);

        CREATE TRIGGER IF NOT EXISTS trg_space_maps_updated_at
        AFTER UPDATE ON space_maps
        BEGIN
          UPDATE space_maps SET updated_at = datetime('now') WHERE id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_space_map_regions_updated_at
        AFTER UPDATE ON space_map_regions
        BEGIN
          UPDATE space_map_regions SET updated_at = datetime('now') WHERE id = NEW.id;
        END;
      `);
    },
  },
  {
    id: "039_tenant_settings",
    up: (db) => {
      // La configuracion deja de ser un singleton global (system_config id = 1)
      // y pasa a una fila por tenant. system_config queda solo como tabla legacy.
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_settings (
          tenant_id INTEGER PRIMARY KEY,
          grace_days INTEGER DEFAULT 5,
          late_interest REAL DEFAULT 1.5,
          overdue_recovery_rate REAL DEFAULT 60,
          company_name TEXT,
          company_rut TEXT,
          company_address TEXT,
          sii_api_key TEXT,
          bank_api_key TEXT,
          sii_provider TEXT DEFAULT 'local_mock',
          sii_mode TEXT DEFAULT 'mock',
          sii_environment TEXT DEFAULT 'demo',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(tenant_id) REFERENCES tenants(id)
        );
      `);

      const settingColumns = [
        "grace_days",
        "late_interest",
        "overdue_recovery_rate",
        "company_name",
        "company_rut",
        "company_address",
        "sii_api_key",
        "bank_api_key",
        "sii_provider",
        "sii_mode",
        "sii_environment",
      ];
      const hasTenants = tableExists(db, "tenants");
      const hasSystemConfig = tableExists(db, "system_config");
      const defaultTenant = hasTenants
        ? db.prepare("SELECT id FROM tenants ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined
        : undefined;

      // 1. El tenant por defecto hereda la fila historica de system_config.
      if (defaultTenant && hasSystemConfig) {
        const legacy = db.prepare("SELECT * FROM system_config WHERE id = 1").get() as Record<string, unknown> | undefined;
        if (legacy) {
          const available = settingColumns.filter(column => columnExists(db, "system_config", column));
          db.prepare(`
            INSERT OR IGNORE INTO tenant_settings (tenant_id, ${available.join(", ")})
            VALUES (?, ${available.map(() => "?").join(", ")})
          `).run(defaultTenant.id, ...available.map(column => legacy[column] ?? null));
          db.prepare(`
            UPDATE tenant_settings
            SET grace_days = COALESCE(grace_days, 5),
                late_interest = COALESCE(late_interest, 1.5),
                overdue_recovery_rate = COALESCE(overdue_recovery_rate, 60),
                sii_provider = COALESCE(sii_provider, 'local_mock'),
                sii_mode = COALESCE(sii_mode, 'mock'),
                sii_environment = COALESCE(sii_environment, 'demo')
            WHERE tenant_id = ?
          `).run(defaultTenant.id);
        }
      }

      // 2. El resto de los tenants parte con defaults y su propia identidad
      //    (nunca con las credenciales ni la razon social de otra empresa).
      if (hasTenants) {
        db.prepare(`
          INSERT OR IGNORE INTO tenant_settings (tenant_id, company_name, company_rut)
          SELECT id, name, rut FROM tenants
        `).run();
      }

      // 3. Compatibilidad: los escritores legacy de system_config (seed base y
      //    seed demo) siguen funcionando y se reflejan solo en el tenant por defecto.
      if (hasSystemConfig && hasTenants) {
        const available = settingColumns.filter(column => columnExists(db, "system_config", column));
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_system_config_sync_tenant_settings_insert
          AFTER INSERT ON system_config
          BEGIN
            INSERT INTO tenant_settings (tenant_id, ${available.join(", ")})
            SELECT t.id, ${available.map(column => `NEW.${column}`).join(", ")}
            FROM (SELECT id FROM tenants ORDER BY id ASC LIMIT 1) t
            WHERE true
            ON CONFLICT(tenant_id) DO UPDATE SET
              ${available.map(column => `${column} = excluded.${column}`).join(",\n              ")},
              updated_at = datetime('now');
          END;
        `);
        for (const column of available) {
          db.exec(`
            CREATE TRIGGER IF NOT EXISTS trg_system_config_sync_tenant_settings_${column}
            AFTER UPDATE OF ${column} ON system_config
            BEGIN
              UPDATE tenant_settings
              SET ${column} = NEW.${column}, updated_at = datetime('now')
              WHERE tenant_id = (SELECT id FROM tenants ORDER BY id ASC LIMIT 1);
            END;
          `);
        }
      }

      // 4. Totems: garantiza tenant_id (agregado en 034) y rellena huerfanos.
      addColumnIfMissing(db, "totems", "tenant_id", "INTEGER REFERENCES tenants(id)");
      if (defaultTenant && tableExists(db, "totems") && columnExists(db, "totems", "tenant_id")) {
        if (columnExists(db, "totems", "branch_id") && columnExists(db, "branches", "tenant_id")) {
          db.prepare(`
            UPDATE totems
            SET tenant_id = (SELECT tenant_id FROM branches WHERE branches.id = totems.branch_id)
            WHERE tenant_id IS NULL
          `).run();
        }
        db.prepare("UPDATE totems SET tenant_id = ? WHERE tenant_id IS NULL").run(defaultTenant.id);
        db.exec("CREATE INDEX IF NOT EXISTS idx_totems_tenant ON totems(tenant_id)");
      }
    },
  },
  {
    id: "040_auth_login_attempts_and_session_idx",
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS auth_login_attempts (
          attempt_key TEXT PRIMARY KEY,
          ip_address TEXT NOT NULL,
          email TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          reset_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_reset_at ON auth_login_attempts(reset_at);
      `);
    },
  },
  {
    id: "041_week4_timezone_and_auth_security",
    up: (db) => {
      addColumnIfMissing(db, "branches", "timezone", "TEXT NOT NULL DEFAULT 'America/Santiago'");
      db.prepare("UPDATE branches SET timezone = 'America/Santiago' WHERE timezone IS NULL OR TRIM(timezone) = ''").run();

      addColumnIfMissing(db, "staff", "totp_secret", "TEXT");
      addColumnIfMissing(db, "staff", "totp_enabled", "INTEGER NOT NULL DEFAULT 0");

      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_password_resets (
          token_hash TEXT PRIMARY KEY,
          staff_id INTEGER NOT NULL REFERENCES staff(id),
          expires_at DATETIME NOT NULL,
          used_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_auth_password_resets_staff ON auth_password_resets(staff_id, expires_at);
      `);
    },
  },
  {
    id: "050_dte_module",
    up: (db) => {
      applyDteMigration(db);
    },
  },
  {
    id: "060_rate_plans_agreements",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rate_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          branch_id INTEGER REFERENCES branches(id),
          -- Todas las versiones de una tarifa comparten group_id; el ticket guarda el id de la version con que entro.
          group_id INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          vehicle_type TEXT NOT NULL DEFAULT 'all',
          mode TEXT NOT NULL DEFAULT 'per_minute' CHECK(mode IN ('per_minute', 'elapsed_blocks')),
          grace_mins INTEGER NOT NULL DEFAULT 0,
          daily_cap INTEGER,
          first_block_minutes INTEGER,
          block_minutes INTEGER,
          valid_from TEXT,
          valid_to TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
          change_note TEXT,
          created_by_staff_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_rate_plans_tenant_status ON rate_plans(tenant_id, status);
        CREATE INDEX IF NOT EXISTS idx_rate_plans_group ON rate_plans(tenant_id, group_id, version);

        CREATE TABLE IF NOT EXISTS rate_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          plan_id INTEGER NOT NULL REFERENCES rate_plans(id),
          sort_order INTEGER NOT NULL DEFAULT 0,
          weekdays TEXT,
          from_time TEXT NOT NULL,
          to_time TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          price_per_minute INTEGER,
          first_block_price INTEGER,
          block_price INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_rate_rules_plan ON rate_rules(plan_id, sort_order);

        CREATE TABLE IF NOT EXISTS agreements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          branch_id INTEGER REFERENCES branches(id),
          name TEXT NOT NULL,
          -- El comercio valida sin iniciar sesion: el codigo identifica el convenio (y la empresa), por eso es unico global.
          code TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK(kind IN ('free_minutes', 'percent', 'fixed')),
          value INTEGER NOT NULL,
          cap_amount INTEGER,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ticket_validations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          ticket_id INTEGER NOT NULL REFERENCES visitor_tickets(id),
          agreement_id INTEGER NOT NULL REFERENCES agreements(id),
          validated_by TEXT NOT NULL DEFAULT 'merchant' CHECK(validated_by IN ('merchant', 'staff')),
          staff_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(ticket_id, agreement_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_validations_ticket ON ticket_validations(ticket_id);
      `);

      addColumnIfMissing(db, "visitor_tickets", "vehicle_type", "TEXT NOT NULL DEFAULT 'car'");
      addColumnIfMissing(db, "visitor_tickets", "rate_plan_id", "INTEGER");
      addColumnIfMissing(db, "visitor_tickets", "lost_ticket", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "visitor_tickets", "lost_ticket_note", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "lost_ticket_evidence_path", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "lost_ticket_evidence_name", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "lost_ticket_by_staff_id", "INTEGER");
      addColumnIfMissing(db, "visitor_ticket_quotes", "rate_plan_id", "INTEGER");
      addColumnIfMissing(db, "visitor_ticket_quotes", "breakdown_json", "TEXT");
    },
  },
  {
    id: "061_payment_gateways",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          provider TEXT NOT NULL CHECK(provider IN ('webpay', 'mock')),
          environment TEXT NOT NULL DEFAULT 'integration' CHECK(environment IN ('integration', 'production')),
          commerce_code TEXT,
          api_secret_encrypted TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          -- Minutos que tiene el cliente para salir despues de pagar en linea.
          exit_window_mins INTEGER NOT NULL DEFAULT 15,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, provider)
        );

        CREATE TABLE IF NOT EXISTS payment_intents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          -- Identificador publico e impredecible (va en la URL de retorno y en la pagina de pago).
          public_id TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK(kind IN ('visitor_ticket', 'receivable')),
          ticket_id INTEGER REFERENCES visitor_tickets(id),
          payment_id INTEGER REFERENCES payments(id),
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CLP',
          idempotency_key TEXT NOT NULL,
          buy_order TEXT NOT NULL,
          provider_token TEXT,
          authorization_code TEXT,
          card_last4 TEXT,
          quote_id INTEGER,
          failure_reason TEXT,
          paid_at DATETIME,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(tenant_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_payment_intents_ticket ON payment_intents(ticket_id, status);
        CREATE INDEX IF NOT EXISTS idx_payment_intents_payment ON payment_intents(payment_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_intents_token ON payment_intents(provider, provider_token);

        CREATE TABLE IF NOT EXISTS payment_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          intent_id INTEGER NOT NULL REFERENCES payment_intents(id),
          kind TEXT NOT NULL,
          -- Id del evento en la pasarela; evita procesar dos veces el mismo aviso.
          external_id TEXT,
          payload_json TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_external ON payment_events(external_id);
        CREATE INDEX IF NOT EXISTS idx_payment_events_intent ON payment_events(intent_id);
      `);
      addColumnIfMissing(db, "visitor_tickets", "public_token", "TEXT");
      addColumnIfMissing(db, "visitor_tickets", "exit_deadline", "DATETIME");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_visitor_tickets_public_token ON visitor_tickets(public_token)");
    },
  },
  {
    id: "062_mail_outbox",
    up: (db) => {
      // Tabla de plataforma (no por empresa): por eso la columna se llama tenant_ref y no tenant_id.
      // Solo la usa el servidor; los correos con enlaces secretos se registran sin su contenido.
      db.exec(`
        CREATE TABLE IF NOT EXISTS mail_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          to_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          template TEXT NOT NULL,
          text_body TEXT,
          html_body TEXT,
          tenant_ref INTEGER,
          dedupe_key TEXT,
          status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'failed', 'skipped')),
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_error TEXT,
          provider_id TEXT,
          transport TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          sent_at DATETIME
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_outbox_dedupe ON mail_outbox(dedupe_key);
        CREATE INDEX IF NOT EXISTS idx_mail_outbox_due ON mail_outbox(status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_mail_outbox_recipient ON mail_outbox(to_email, template, created_at);
      `);
    },
  },
  {
    id: "070_self_serve_signup",
    up: (db) => {
      addColumnIfMissing(db, "staff", "email_verified", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "staff", "email_verified_at", "DATETIME");
      db.exec(`
        UPDATE staff
        SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
        WHERE email_verified = 1 AND email_verified_at IS NULL;

        CREATE TABLE IF NOT EXISTS auth_email_verifications (
          token_hash TEXT PRIMARY KEY,
          staff_id INTEGER NOT NULL REFERENCES staff(id),
          email TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          verified_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_staff ON auth_email_verifications(staff_id, expires_at);
      `);
    },
  },
  {
    id: "071_onboarding_state",
    up: (db) => {
      addColumnIfMissing(db, "tenant_settings", "onboarding_dismissed", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "tenant_settings", "onboarding_staff_skipped", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    id: "072_subscription_lifecycle",
    up: (db) => {
      addColumnIfMissing(db, "subscriptions", "grace_until", "TEXT");
      addColumnIfMissing(db, "subscriptions", "suspended_at", "DATETIME");
      addColumnIfMissing(db, "subscriptions", "last_notice_at", "DATETIME");
    },
  },
  {
    id: "073_platform_impersonation",
    up: (db) => {
      addColumnIfMissing(db, "auth_sessions", "impersonated_by_staff_id", "INTEGER REFERENCES staff(id)");
      addColumnIfMissing(db, "auth_sessions", "impersonated_tenant_id", "INTEGER REFERENCES tenants(id)");
      addColumnIfMissing(db, "auth_sessions", "impersonation_expires_at", "DATETIME");
      addColumnIfMissing(db, "auth_sessions", "impersonation_reason", "TEXT");
    },
  },
  {
    id: "074_ley_21719",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS privacy_consents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          subject_type TEXT NOT NULL,
          subject_id INTEGER,
          subject_identifier TEXT NOT NULL,
          purpose TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          granted INTEGER NOT NULL DEFAULT 1,
          ip_address TEXT,
          user_agent TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_privacy_consents_tenant_subject ON privacy_consents(tenant_id, subject_identifier, created_at);
        CREATE INDEX IF NOT EXISTS idx_privacy_consents_purpose ON privacy_consents(tenant_id, purpose);
      `);
      addColumnIfMissing(db, "staff", "anonymized_at", "DATETIME");
      addColumnIfMissing(db, "clients", "anonymized_at", "DATETIME");
      addColumnIfMissing(db, "visitor_tickets", "anonymized_at", "DATETIME");
    },
  },
];
