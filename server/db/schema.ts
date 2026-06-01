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
];
