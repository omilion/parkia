export interface Client {
  id: number;
  name: string;
  email: string;
  phone: string;
  rut: string;
  type: 'natural' | 'company';
  status?: 'active' | 'archived';
  financial_status: 'up-to-date' | 'overdue';
  created_at: string;
  products?: string; // Comma separated list of space names
  plate?: string;
  plates?: string;
  vehicles_count?: number;
  active_contract_count?: number;
  total_debt?: number;
  address?: string | null;
  commune?: string | null;
  city?: string | null;
  business_activity?: string | null;
  legal_representative_name?: string | null;
  legal_representative_rut?: string | null;
  billing_contact_name?: string | null;
  billing_contact_email?: string | null;
  billing_contact_phone?: string | null;
  notes?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Space {
  id: number;
  name: string;
  type: 'parking' | 'storage';
  status: 'available' | 'occupied' | 'maintenance';
  price: number;
  branch_id?: number | null;
  branch_name?: string | null;
  branch_code?: string | null;
  location?: string | null;
  level?: string | null;
  width_m?: number | null;
  length_m?: number | null;
  height_m?: number | null;
  features?: string | null;
  notes?: string | null;
  updated_at?: string | null;
  assigned_client?: {
    id: number;
    name: string;
    rut?: string;
    financial_status?: string;
  };
  is_present?: boolean;
  entry_time?: string;
  current_plate?: string;
}

export interface Branch {
  id: number;
  name: string;
  code: string;
  address?: string | null;
  commune?: string | null;
  city?: string | null;
  phone?: string | null;
  status: 'active' | 'inactive';
  spaces_count?: number;
  active_tickets_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface VisitorTicket {
  id: number;
  plate: string;
  entry_time: string;
  exit_time: string | null;
  amount: number;
  status: 'active' | 'paid' | 'completed';
  payment_method: string | null;
  paid_at?: string | null;
  quoted_amount?: number | null;
  space_id?: number | null;
  space_name?: string | null;
  entry_method?: 'manual' | 'totem' | 'qr' | string | null;
}

export interface VisitorReceipt {
  receipt_number: string;
  ticket_id: number;
  plate: string;
  space_id: number | null;
  space_name: string | null;
  entry_time: string;
  paid_at: string | null;
  duration_mins: number;
  grace_period_mins: number;
  billable_mins: number;
  rate_per_minute: number;
  billing_mode: string;
  subtotal: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  payment_method: string;
  cashier_name: string | null;
  cash_session_id: number | null;
  legal_note: string;
}

export interface VisitorQuote {
  id: number;
  visitor_id: number;
  total: number;
  duration_minutes: number;
  billable_mins?: number;
  rate_per_minute?: number;
  billing_mode?: 'per_minute' | string;
  grace_period_mins: number;
}

export interface Contract {
  id: number;
  client_id: number;
  space_id: number;
  start_date: string;
  end_date: string | null;
  monthly_fee: number;
  billing_day: number;
  deposit_amount: number;
  billing_document_type: 'boleta' | 'factura_exenta' | 'factura_afecta';
  notes: string | null;
  status: 'active' | 'suspended' | 'terminated';
  client_name?: string;
  space_name?: string;
  space_type?: 'parking' | 'storage';
  plate?: string;
  plates?: string;
  pending_amount?: number;
  documents_count?: number;
}

export interface Vehicle {
  id: number;
  client_id?: number;
  plate: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  notes?: string | null;
}

export interface ClientDetail {
  client: Client;
  contracts: Contract[];
  payments: Payment[];
  access: AccessLog[];
}

export interface Payment {
  id: number;
  contract_id: number;
  amount: number;
  due_date: string;
  payment_date: string | null;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  method: 'cash' | 'transfer' | 'card' | 'automatic' | null;
  reference: string | null;
  receipt_file_path: string | null;
  receipt_file_name: string | null;
  receipt_mime_type: string | null;
  client_name?: string;
  client_rut?: string;
  contract_id_display?: string;
  allocated_amount?: number;
  remaining_amount?: number;
  open_collection_actions_count?: number;
  next_collection_action_at?: string | null;
  latest_collection_note?: string | null;
}

export interface PaymentAdjustment {
  id: number;
  payment_id: number;
  staff_id: number | null;
  staff_name?: string | null;
  type: 'discount' | 'waiver' | 'fee';
  amount: number;
  previous_amount: number;
  new_amount: number;
  reason: string;
  created_at: string;
}

export interface DocumentRecord {
  id: number;
  entity_type: 'client' | 'contract' | 'payment';
  entity_id: number;
  label: string;
  document_type: 'contract' | 'identity' | 'mandate' | 'receipt' | 'other';
  status: 'pending' | 'received' | 'approved' | 'rejected' | 'expired';
  expires_at: string | null;
  notes: string | null;
  assigned_staff_id?: number | null;
  assigned_staff_name?: string | null;
  assigned_staff_email?: string | null;
  next_action_at?: string | null;
  reviewed_by_staff_id?: number | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface BankMovement {
  id: number;
  date: string;
  description: string;
  rut: string;
  amount: number;
  allocated_amount?: number;
  remaining_amount?: number;
  notes: string | null;
  status: 'pending' | 'reconciled' | 'partial';
}

export interface PaymentAllocation {
  id: number;
  payment_id: number;
  bank_movement_id: number;
  amount: number;
  note: string | null;
  created_at: string;
  reversed_at?: string | null;
  reversed_note?: string | null;
  payment_amount?: number;
  payment_due_date?: string;
  payment_status?: Payment['status'];
  client_name?: string;
  client_rut?: string;
  contract_id_display?: string;
  movement_date?: string;
  movement_description?: string;
  movement_rut?: string;
  movement_amount?: number;
  movement_status?: BankMovement['status'];
}

export interface CollectionAction {
  id: number;
  payment_id: number;
  staff_id: number | null;
  staff_name?: string | null;
  staff_email?: string | null;
  channel: 'phone' | 'email' | 'whatsapp' | 'in_person' | 'other';
  note: string;
  next_action_at: string | null;
  status: 'open' | 'done';
  completed_at: string | null;
  completed_note: string | null;
  created_at: string;
  payment_amount?: number;
  payment_due_date?: string;
  payment_status?: Payment['status'];
  payment_remaining_amount?: number;
  contract_id_display?: string;
  client_name?: string;
  client_rut?: string;
  client_email?: string | null;
  client_phone?: string | null;
}

export interface Expense {
  id: number;
    date: string;
    category: 'rent' | 'maintenance' | 'utilities' | 'payroll' | 'supplies' | 'taxes' | 'admin' | 'other';
    cost_center?: string | null;
    supplier_name: string;
  supplier_rut: string | null;
  description: string;
  amount_net: number;
  tax_amount: number;
  amount_total: number;
  document_type: 'invoice' | 'receipt' | 'ticket' | 'internal' | 'none';
  document_number: string | null;
  payment_method: 'cash' | 'transfer' | 'card' | 'automatic' | 'other' | null;
  payment_status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paid_at: string | null;
  due_date: string | null;
  bank_movement_id: number | null;
  receipt_file_path: string | null;
  receipt_file_name: string | null;
  receipt_mime_type: string | null;
    notes: string | null;
    approval_status?: 'pending' | 'approved' | 'rejected';
    approved_by_staff_id?: number | null;
    approved_by_name?: string | null;
    approved_at?: string | null;
    approval_note?: string | null;
    created_at: string;
  }

export interface FinancialBudget {
  id: number;
  month: string;
  category: Expense['category'];
  planned_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: number;
  folio: number;
  type: 'boleta' | 'factura_exenta' | 'factura_afecta';
  client_id: number;
  client_name?: string;
  client_rut?: string | null;
  billing_contact_email?: string | null;
  amount: number;
  date: string;
  status_sii: 'accepted' | 'rejected' | 'pending';
  payment_id?: number | null;
  contract_id?: number | null;
  provider?: string | null;
  provider_mode?: string | null;
  external_id?: string | null;
  track_id?: string | null;
  status_detail?: string | null;
  rejection_reason?: string | null;
  validation_errors_json?: string | null;
  issued_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  last_sync_at?: string | null;
}

export interface FinanceSummary {
  totalPending: number;
  totalCollected: number;
  totalOverdue: number;
  overdueClientsCount: number;
  pendingExpenses?: number;
  overdueExpenses?: number;
  projectedCashBalance?: number;
}

export interface AccessLog {
  id: number;
  client_id: number | null;
  visitor_id: number | null;
  space_id: number | null;
  access_type: 'entry' | 'exit';
  status: 'authorized' | 'denied';
  method: 'fingerprint' | 'card' | 'qr' | 'manual';
  reason?: string;
  authorized_by?: string;
  resolved_by_access_log_id?: number | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  timestamp: string;
  client_name?: string;
  space_name?: string;
  visitor_name?: string;
  plate?: string;
}

export interface VisitorPass {
  id: number;
  name: string;
  rut: string;
  type: 'provider' | 'family' | 'maintenance' | 'other';
  reason: string;
  plate?: string | null;
  phone?: string | null;
  company?: string | null;
  authorized_by?: string | null;
  associated_space_id?: number;
  space_name?: string | null;
  valid_from: string;
  valid_to: string;
  qr_token: string;
  status: 'waiting' | 'inside' | 'completed' | 'expired';
  created_at: string;
}

export interface StaffUser {
  id: number;
  name: string;
  rut: string;
  email: string;
  phone: string;
  role: 'admin' | 'finance' | 'guard' | 'cashier';
  status: 'active' | 'inactive';
  last_access: string | null;
  must_change_password?: boolean;
  password_changed_at?: string | null;
  updated_at?: string | null;
}

export interface StaffAccessEvent {
  id: number;
  staff_id: number;
  event_type: 'login' | 'logout' | 'password_changed' | 'password_reset' | 'status_changed' | 'profile_updated' | 'role_changed';
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

export interface OperationalTask {
  id: number;
  title: string;
  description: string | null;
  category: 'finance' | 'access' | 'documents' | 'contracts' | 'maintenance' | 'general';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  assigned_staff_id: number | null;
  assigned_staff_name?: string | null;
  assigned_staff_email?: string | null;
  source_type: string | null;
  source_id: string | null;
  source_href?: string | null;
  source_label?: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_note: string | null;
  created_by_staff_id: number | null;
  created_by_staff_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  staff_id: number | null;
  note: string;
  created_at: string;
  staff_name?: string | null;
  staff_email?: string | null;
  attachment_id?: number | null;
  attachment_label?: string | null;
  attachment_file_name?: string | null;
  attachment_mime_type?: string | null;
  attachment_size_bytes?: number | null;
}

export interface SystemConfig {
  grace_days: number;
  late_interest: number;
  overdue_recovery_rate: number;
  company_name: string;
  company_rut: string;
  company_address: string;
  sii_api_key: string;
  sii_provider: 'local_mock' | 'external_provider';
  sii_mode: 'disabled' | 'mock' | 'real';
  sii_environment: 'demo' | 'production';
  bank_api_key: string;
}

export interface Totem {
  id: number;
  name: string;
  status: 'online' | 'offline';
  maintenance_mode: boolean;
  last_heartbeat: string;
}

export interface AccessRate {
  id: number;
  type: string;
  rate_per_hour: number;
  rate_per_minute: number;
  billing_mode?: 'per_minute' | string;
  grace_period_mins: number;
}

export interface GuardShiftLog {
  id: number;
  staff_id: number;
  staff_name?: string;
  staff_email?: string;
  cash_session_id?: number | null;
  shift_date: string;
  shift_name: 'morning' | 'afternoon' | 'night' | 'custom';
  opening_notes: string | null;
  handover_notes: string | null;
  cash_count_note: string | null;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  entries_count: number;
  pending_follow_ups: number;
}

export interface CashSessionSummary {
  session: {
    id: number;
    staff_id: number;
    shift_log_id: number | null;
    status: 'open' | 'closed';
    opening_cash: number;
    expected_cash: number;
    counted_cash: number | null;
    counted_transfer: number | null;
    counted_card: number | null;
    difference_cash: number | null;
    opened_at: string;
    closed_at: string | null;
  };
  byMethod: { method: string; total: number; count: number }[];
  totals: Record<string, number>;
  expectedCash: number;
  tickets: Pick<VisitorTicket, 'id' | 'plate' | 'amount' | 'payment_method' | 'status'>[];
  blockers: {
    paidTicketsAwaitingExit: number;
  };
  warnings: {
    activeVisitorTickets: number;
    unresolvedDeniedExits: number;
  };
}

export interface CashSessionClosure {
  id: number;
  staff_id: number | null;
  staff_name?: string | null;
  shift_log_id: number | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number;
  counted_cash: number;
  counted_transfer: number;
  counted_card: number;
  difference_cash: number;
  notes: string | null;
  closed_by_staff_id: number | null;
  closed_by_name?: string | null;
  snapshot_json?: string | null;
  created_at?: string | null;
  tickets_count: number;
}

export interface GuardShiftLogEntry {
  id: number;
  shift_log_id: number;
  staff_id: number;
  staff_name?: string;
  task_id: number | null;
  task_status?: OperationalTask['status'] | null;
  task_title?: string | null;
  category: 'access' | 'visitor' | 'incident' | 'maintenance' | 'payment' | 'handover' | 'other';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  detail: string | null;
  related_space_id: number | null;
  related_space_name?: string | null;
  related_access_log_id: number | null;
  follow_up_required: boolean;
  attachment_count?: number;
  attachment_id?: number | null;
  attachment_file_name?: string | null;
  resolved_at: string | null;
  created_at: string;
  shift_date?: string;
  shift_name?: GuardShiftLog['shift_name'];
  shift_status?: GuardShiftLog['status'];
  shift_staff_name?: string;
}

export interface DashboardAlert {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  count: number;
  amount?: number;
  href: string;
  actionLabel: string;
  taskId: number | null;
}

export interface OperationsDailyReport {
  date: string;
  timezone: string;
  window_start_utc: string;
  window_end_utc: string;
  visitorRevenue: {
    total: number;
    count: number;
    cash: number;
    card: number;
    transfer: number;
  };
  cashClosures: {
    count: number;
    expectedCash: number;
    countedCash: number;
    differenceCash: number;
    withDifference: number;
    openSessions: number;
  };
  tickets: {
    active: number;
    paidAwaitingExit: number;
    completedToday: number;
    staleActive: number;
  };
  access: {
    total: number;
    entries: number;
    exits: number;
    denied: number;
    unresolvedDeniedExits: number;
    hourly: { hour: number; count: number; entries: number; exits: number; denied: number }[];
  };
  occupancy: {
    total: number;
    occupied: number;
    available: number;
    maintenance: number;
  };
  byCashier: {
    cashierName: string;
    tickets: number;
    total: number;
    cash: number;
    card: number;
    transfer: number;
  }[];
  alerts: {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
  }[];
}

export interface DashboardData {
  occupancy: {
    total: number;
    occupied: number;
    parking_free: number;
    storage_free: number;
    available_parking: Pick<Space, 'id' | 'name' | 'type' | 'location' | 'level'>[];
    available_storage: Pick<Space, 'id' | 'name' | 'type' | 'location' | 'level'>[];
  };
  revenue: {
    total_collected: number;
    target: number;
    trend: number; // percentage change
  };
  access: {
    business_date: string;
    timezone: string;
    window_start_utc: string;
    window_end_utc: string;
    daily_total: number;
    today_total: number;
    today_authorized_total: number;
    today_entries: number;
    today_exits: number;
    today_denied: number;
    entries: number;
    exits: number;
    denied: number;
    hourly_peaks: { hour: number, count: number }[];
    hourly_series: { hour: number, count: number, entries: number, exits: number, denied: number }[];
    today_access: (AccessLog & { client_name?: string, visitor_name?: string, space_name?: string })[];
    recent_access: (AccessLog & { client_name?: string, visitor_name?: string, space_name?: string })[];
    last_event_at: string | null;
  };
  expiring_contracts: (Contract & { client_name: string, space_name: string })[];
  recent_payments: (Payment & { client_name: string })[];
  live_access: (AccessLog & { client_name?: string, visitor_name?: string })[];
  alerts: DashboardAlert[];
  operations_daily: OperationsDailyReport;
}

export interface SearchResult {
  id: number;
  type: 'client' | 'contract' | 'space';
  title: string;
  subtitle: string;
  link: string;
}
