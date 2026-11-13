import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// 1. Plataforma y Multi-tenant (SaaS)
// ============================================================================

export const schemaMigrations = pgTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rut: text("rut"),
  status: text("status").default("active").notNull(), // active | suspended | archived
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  maxBranches: integer("max_branches"),
  maxSpaces: integer("max_spaces"),
  maxUsers: integer("max_users"),
  monthlyTicketLimit: integer("monthly_ticket_limit"),
  priceClp: integer("price_clp").default(0).notNull(),
  priceUfCentis: integer("price_uf_centis").default(0).notNull(),
  status: text("status").default("active").notNull(), // active | archived
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    rut: text("rut").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone"),
    role: text("role").notNull(), // admin | finance | guard | cashier
    status: text("status").default("active").notNull(), // active | inactive
    passwordHash: text("password_hash"),
    lastAccess: timestamp("last_access", { withTimezone: true }),
    mustChangePassword: integer("must_change_password").default(0).notNull(),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    totpSecret: text("totp_secret"),
    totpEnabled: integer("totp_enabled").default(0).notNull(),
    emailVerified: integer("email_verified").default(1).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_staff_role_status").on(t.role, t.status)],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    role: text("role").default("member").notNull(), // owner | admin | member
    status: text("status").default("active").notNull(), // active | inactive
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_tenant_memberships_tenant_staff").on(t.tenantId, t.staffId),
    index("idx_tenant_memberships_staff").on(t.staffId, t.status),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status").default("trialing").notNull(), // trialing | active | past_due | suspended | cancelled
    currentPeriodStart: date("current_period_start"),
    currentPeriodEnd: date("current_period_end"),
    graceUntil: date("grace_until"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    lastNoticeAt: timestamp("last_notice_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_subscriptions_tenant_status").on(t.tenantId, t.status, t.currentPeriodEnd)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    impersonatedByStaffId: integer("impersonated_by_staff_id").references(() => staff.id),
    impersonatedTenantId: integer("impersonated_tenant_id").references(() => tenants.id),
    impersonationExpiresAt: timestamp("impersonation_expires_at", { withTimezone: true }),
    impersonationReason: text("impersonation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_auth_sessions_expires_at").on(t.expiresAt)],
);

export const authLoginAttempts = pgTable(
  "auth_login_attempts",
  {
    attemptKey: text("attempt_key").primaryKey(),
    ipAddress: text("ip_address").notNull(),
    email: text("email").notNull(),
    count: integer("count").default(1).notNull(),
    resetAt: bigint("reset_at", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_auth_login_attempts_reset_at").on(t.resetAt)],
);

export const authPasswordResets = pgTable(
  "auth_password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_auth_password_resets_staff").on(t.staffId, t.expiresAt)],
);

export const authEmailVerifications = pgTable(
  "auth_email_verifications",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_auth_email_verifications_staff").on(t.staffId, t.expiresAt)],
);

export const staffAccessEvents = pgTable(
  "staff_access_events",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_staff_access_events_staff").on(t.staffId, t.createdAt),
    index("idx_staff_access_events_created").on(t.createdAt),
  ],
);

// ============================================================================
// 2. Configuracion y Sucursales (con RLS por tenant_id)
// ============================================================================

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: integer("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  graceDays: integer("grace_days").default(5).notNull(),
  lateInterest: doublePrecision("late_interest").default(1.5).notNull(),
  overdueRecoveryRate: doublePrecision("overdue_recovery_rate").default(60).notNull(),
  companyName: text("company_name"),
  companyRut: text("company_rut"),
  companyAddress: text("company_address"),
  siiApiKey: text("sii_api_key"),
  bankApiKey: text("bank_api_key"),
  siiProvider: text("sii_provider").default("local_mock").notNull(),
  siiMode: text("sii_mode").default("mock").notNull(),
  siiEnvironment: text("sii_environment").default("demo").notNull(),
  onboardingDismissed: integer("onboarding_dismissed").default(0).notNull(),
  onboardingStaffSkipped: integer("onboarding_staff_skipped").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const branches = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
    commune: text("commune"),
    city: text("city"),
    phone: text("phone"),
    timezone: text("timezone").default("America/Santiago").notNull(),
    status: text("status").default("active").notNull(), // active | inactive
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_branches_tenant_code").on(t.tenantId, t.code),
    index("idx_branches_tenant").on(t.tenantId),
    index("idx_branches_status").on(t.status, t.name),
  ],
);

// ============================================================================
// 3. Clientes, Vehiculos, Plazas y Mapas
// ============================================================================

export const clients = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    rut: text("rut"),
    type: text("type").default("natural").notNull(), // natural | company
    financialStatus: text("financial_status").default("up-to-date").notNull(), // up-to-date | overdue
    status: text("status").default("active").notNull(), // active | archived
    address: text("address"),
    commune: text("commune"),
    city: text("city"),
    businessActivity: text("business_activity"),
    legalRepresentativeName: text("legal_representative_name"),
    legalRepresentativeRut: text("legal_representative_rut"),
    billingContactName: text("billing_contact_name"),
    billingContactEmail: text("billing_contact_email"),
    billingContactPhone: text("billing_contact_phone"),
    notes: text("notes"),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_clients_tenant_rut").on(t.tenantId, t.rut),
    index("idx_clients_tenant").on(t.tenantId),
    index("idx_clients_status").on(t.status),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    clientId: integer("client_id").references(() => clients.id),
    plate: text("plate").notNull(),
    brand: text("brand"),
    model: text("model"),
    color: text("color"),
    notes: text("notes"),
    status: text("status").default("active").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveReason: text("archive_reason"),
  },
  (t) => [
    uniqueIndex("uq_vehicles_tenant_plate").on(t.tenantId, t.plate),
    index("idx_vehicles_client").on(t.clientId),
    index("idx_vehicles_status_client").on(t.status, t.clientId),
  ],
);

export const spaces = pgTable(
  "spaces",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    type: text("type").default("parking").notNull(),
    status: text("status").default("available").notNull(), // available | occupied | maintenance
    price: integer("price").notNull(),
    notes: text("notes"),
    location: text("location"),
    level: text("level"),
    widthM: doublePrecision("width_m"),
    lengthM: doublePrecision("length_m"),
    heightM: doublePrecision("height_m"),
    features: text("features"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_spaces_tenant").on(t.tenantId),
    index("idx_spaces_branch_status").on(t.branchId, t.status, t.type),
  ],
);

export const spaceStatusHistory = pgTable(
  "space_status_history",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    spaceId: integer("space_id")
      .notNull()
      .references(() => spaces.id),
    staffId: integer("staff_id").references(() => staff.id),
    previousStatus: text("previous_status"),
    status: text("status").notNull(),
    reason: text("reason"),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_space_status_history_tenant").on(t.tenantId),
    index("idx_space_status_history_space").on(t.spaceId, t.createdAt),
  ],
);

export const spaceMaps = pgTable(
  "space_maps",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id),
    name: text("name").notNull(),
    imageFilePath: text("image_file_path").notNull(),
    imageFileName: text("image_file_name").notNull(),
    imageMimeType: text("image_mime_type").notNull(),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    status: text("status").default("active").notNull(),
    isDefault: integer("is_default").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_space_maps_tenant_branch_name").on(t.tenantId, t.branchId, t.name),
    index("idx_space_maps_tenant_branch").on(t.tenantId, t.branchId, t.status),
    index("idx_space_maps_default").on(t.tenantId, t.branchId, t.isDefault),
  ],
);

export const spaceMapRegions = pgTable(
  "space_map_regions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    mapId: integer("map_id")
      .notNull()
      .references(() => spaceMaps.id, { onDelete: "cascade" }),
    spaceId: integer("space_id")
      .notNull()
      .references(() => spaces.id),
    geometryJson: text("geometry_json").notNull(),
    label: text("label"),
    color: text("color"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_space_map_regions_tenant_map_space").on(t.tenantId, t.mapId, t.spaceId),
    index("idx_space_map_regions_map").on(t.tenantId, t.mapId, t.sortOrder),
    index("idx_space_map_regions_space").on(t.tenantId, t.spaceId),
  ],
);

// ============================================================================
// 4. Contratos, Cobranza y Finanzas
// ============================================================================

export const contracts = pgTable(
  "contracts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    clientId: integer("client_id").references(() => clients.id),
    spaceId: integer("space_id").references(() => spaces.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    monthlyFee: integer("monthly_fee").notNull(),
    billingDay: integer("billing_day").default(5).notNull(),
    depositAmount: integer("deposit_amount").default(0).notNull(),
    billingDocumentType: text("billing_document_type").default("boleta").notNull(),
    notes: text("notes"),
    status: text("status").default("active").notNull(), // active | suspended | terminated
  },
  (t) => [
    index("idx_contracts_tenant").on(t.tenantId),
    index("idx_contracts_branch_status").on(t.branchId, t.status),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    contractId: integer("contract_id").references(() => contracts.id),
    amount: integer("amount").notNull(),
    dueDate: date("due_date").notNull(),
    paymentDate: date("payment_date", { mode: "string" }),
    status: text("status").default("pending").notNull(), // pending | paid | overdue | cancelled
    method: text("method"), // cash | transfer | card | automatic
    reference: text("reference"),
    receiptFilePath: text("receipt_file_path"),
    receiptFileName: text("receipt_file_name"),
    receiptMimeType: text("receipt_mime_type"),
  },
  (t) => [
    index("idx_payments_tenant").on(t.tenantId),
    index("idx_payments_branch_status").on(t.branchId, t.status, t.dueDate),
  ],
);

export const bankMovements = pgTable(
  "bank_movements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    date: date("date").notNull(),
    description: text("description"),
    rut: text("rut"),
    amount: integer("amount").notNull(),
    notes: text("notes"),
    status: text("status").default("pending").notNull(), // pending | reconciled | partial
  },
  (t) => [
    index("idx_bank_movements_tenant").on(t.tenantId),
    index("idx_bank_movements_branch_status").on(t.branchId, t.status, t.date),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    bankMovementId: integer("bank_movement_id")
      .notNull()
      .references(() => bankMovements.id),
    amount: integer("amount").notNull(),
    note: text("note"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedNote: text("reversed_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_payment_allocations_tenant").on(t.tenantId),
    index("idx_payment_allocations_active_payment").on(t.paymentId, t.reversedAt),
    index("idx_payment_allocations_active_movement").on(t.bankMovementId, t.reversedAt),
  ],
);

export const paymentAdjustments = pgTable(
  "payment_adjustments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    staffId: integer("staff_id").references(() => staff.id),
    type: text("type").notNull(), // discount | waiver | fee
    amount: integer("amount").notNull(),
    previousAmount: integer("previous_amount").notNull(),
    newAmount: integer("new_amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_payment_adjustments_tenant_payment").on(t.tenantId, t.paymentId, t.createdAt)],
);

export const collectionActions = pgTable(
  "collection_actions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    staffId: integer("staff_id").references(() => staff.id),
    channel: text("channel").notNull(), // phone | email | whatsapp | in_person | other
    note: text("note").notNull(),
    nextActionAt: date("next_action_at"),
    status: text("status").default("open").notNull(), // open | done
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedNote: text("completed_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_collection_actions_tenant").on(t.tenantId),
    index("idx_collection_actions_payment").on(t.paymentId, t.status),
    index("idx_collection_actions_next").on(t.status, t.nextActionAt),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    date: date("date").notNull(),
    category: text("category").notNull(),
    costCenter: text("cost_center").default("general").notNull(),
    supplierName: text("supplier_name").notNull(),
    supplierRut: text("supplier_rut"),
    description: text("description").notNull(),
    amountNet: integer("amount_net").default(0).notNull(),
    taxAmount: integer("tax_amount").default(0).notNull(),
    amountTotal: integer("amount_total").notNull(),
    documentType: text("document_type").default("invoice").notNull(),
    documentNumber: text("document_number"),
    paymentMethod: text("payment_method"),
    paymentStatus: text("payment_status").default("pending").notNull(),
    paidAt: date("paid_at"),
    dueDate: date("due_date"),
    bankMovementId: integer("bank_movement_id").references(() => bankMovements.id),
    receiptFilePath: text("receipt_file_path"),
    receiptFileName: text("receipt_file_name"),
    receiptMimeType: text("receipt_mime_type"),
    notes: text("notes"),
    approvalStatus: text("approval_status").default("pending").notNull(),
    approvedByStaffId: integer("approved_by_staff_id").references(() => staff.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_expenses_tenant").on(t.tenantId),
    index("idx_expenses_date").on(t.date),
    index("idx_expenses_status").on(t.paymentStatus, t.dueDate),
    index("idx_expenses_category").on(t.category),
  ],
);

export const financialBudgets = pgTable(
  "financial_budgets",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    month: text("month").notNull(),
    category: text("category").notNull(),
    plannedAmount: integer("planned_amount").default(0).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_financial_budgets_tenant_month_cat").on(t.tenantId, t.month, t.category),
    index("idx_financial_budgets_tenant_month").on(t.tenantId, t.month),
  ],
);

export const monthlyFinanceClosures = pgTable(
  "monthly_finance_closures",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    month: text("month").notNull(),
    status: text("status").default("closed").notNull(),
    closedByStaffId: integer("closed_by_staff_id").references(() => staff.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow(),
    acceptedPendingNote: text("accepted_pending_note"),
    monthlySnapshotJson: text("monthly_snapshot_json").notNull(),
    operationalSnapshotJson: text("operational_snapshot_json").notNull(),
    reopenedByStaffId: integer("reopened_by_staff_id").references(() => staff.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedReason: text("reopened_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_monthly_finance_closures_tenant_month").on(t.tenantId, t.month),
    index("idx_monthly_finance_closures_tenant_month").on(t.tenantId, t.month),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    folio: integer("folio").notNull(),
    type: text("type").notNull(), // boleta | factura_exenta | factura_afecta
    clientId: integer("client_id").references(() => clients.id),
    paymentId: integer("payment_id").references(() => payments.id),
    contractId: integer("contract_id").references(() => contracts.id),
    amount: integer("amount").notNull(),
    date: timestamp("date", { withTimezone: true }).defaultNow(),
    statusSii: text("status_sii").default("accepted").notNull(),
    provider: text("provider").default("local_mock"),
    providerMode: text("provider_mode").default("mock"),
    externalId: text("external_id"),
    trackId: text("track_id"),
    statusDetail: text("status_detail"),
    rejectionReason: text("rejection_reason"),
    validationErrorsJson: text("validation_errors_json"),
    siiPayloadJson: text("sii_payload_json"),
    siiResponseJson: text("sii_response_json"),
    pdfContent: text("pdf_content"),
    xmlContent: text("xml_content"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_invoices_tenant_type_folio").on(t.tenantId, t.type, t.folio),
    index("idx_invoices_tenant").on(t.tenantId),
    index("idx_invoices_payment").on(t.paymentId),
    index("idx_invoices_contract").on(t.contractId),
  ],
);

export const siiEvents = pgTable(
  "sii_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    staffId: integer("staff_id").references(() => staff.id),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    payloadJson: text("payload_json"),
    responseJson: text("response_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_sii_events_tenant").on(t.tenantId),
    index("idx_sii_events_invoice").on(t.invoiceId, t.createdAt),
  ],
);

// ============================================================================
// 5. Accesos, Visitas, Tarifas, Turnos y Caja
// ============================================================================

export const accessRates = pgTable(
  "access_rates",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    type: text("type").notNull(),
    ratePerHour: integer("rate_per_hour").notNull(),
    ratePerMinute: integer("rate_per_minute"),
    gracePeriodMins: integer("grace_period_mins").default(15).notNull(),
    billingMode: text("billing_mode").default("per_minute").notNull(),
  },
  (t) => [
    uniqueIndex("uq_access_rates_tenant_branch_type").on(t.tenantId, t.branchId, t.type),
    index("idx_access_rates_tenant").on(t.tenantId),
  ],
);

export const guardShiftLogs = pgTable(
  "guard_shift_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    cashSessionId: integer("cash_session_id"),
    shiftDate: date("shift_date").notNull(),
    shiftName: text("shift_name").default("custom").notNull(),
    openingNotes: text("opening_notes"),
    handoverNotes: text("handover_notes"),
    cashCountNote: text("cash_count_note"),
    status: text("status").default("open").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_guard_shift_logs_tenant").on(t.tenantId),
    index("idx_guard_shift_logs_status").on(t.status, t.shiftDate),
  ],
);

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    staffId: integer("staff_id").references(() => staff.id),
    shiftLogId: integer("shift_log_id").references(() => guardShiftLogs.id),
    status: text("status").default("open").notNull(),
    openingCash: integer("opening_cash").default(0).notNull(),
    expectedCash: integer("expected_cash").default(0).notNull(),
    countedCash: integer("counted_cash"),
    countedTransfer: integer("counted_transfer"),
    countedCard: integer("counted_card"),
    differenceCash: integer("difference_cash"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_cash_sessions_tenant").on(t.tenantId),
    index("idx_cash_sessions_branch_status").on(t.branchId, t.status, t.openedAt),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    cashSessionId: integer("cash_session_id")
      .notNull()
      .references(() => cashSessions.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    method: text("method").notNull(),
    direction: text("direction").default("in").notNull(),
    amount: integer("amount").notNull(),
    createdByStaffId: integer("created_by_staff_id").references(() => staff.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_cash_movements_tenant").on(t.tenantId),
    index("idx_cash_movements_session").on(t.cashSessionId, t.createdAt),
    uniqueIndex("idx_cash_movements_unique_source")
      .on(t.tenantId, t.sourceType, t.sourceId, t.direction)
      .where(sql`${t.direction} = 'in'`),
  ],
);

export const cashSessionClosures = pgTable(
  "cash_session_closures",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    cashSessionId: integer("cash_session_id")
      .notNull()
      .references(() => cashSessions.id),
    closedByStaffId: integer("closed_by_staff_id").references(() => staff.id),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_cash_session_closures_tenant").on(t.tenantId)],
);

export const visitorTickets = pgTable(
  "visitor_tickets",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    plate: text("plate"),
    entryTime: timestamp("entry_time", { withTimezone: true }).defaultNow(),
    exitTime: timestamp("exit_time", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    amount: integer("amount").default(0).notNull(),
    quotedAmount: integer("quoted_amount"),
    status: text("status").default("active").notNull(), // active | paid | completed
    paymentMethod: text("payment_method"),
    paymentOverrideReason: text("payment_override_reason"),
    spaceId: integer("space_id").references(() => spaces.id),
    quoteId: integer("quote_id"),
    cashSessionId: integer("cash_session_id").references(() => cashSessions.id),
    createdByStaffId: integer("created_by_staff_id").references(() => staff.id),
    paidByStaffId: integer("paid_by_staff_id").references(() => staff.id),
    completedByStaffId: integer("completed_by_staff_id").references(() => staff.id),
    entryMethod: text("entry_method").default("manual").notNull(),
    receiptFilePath: text("receipt_file_path"),
    receiptFileName: text("receipt_file_name"),
    receiptMimeType: text("receipt_mime_type"),
    vehicleType: text("vehicle_type").default("car").notNull(), // car | moto | truck
    ratePlanId: integer("rate_plan_id"), // version de la tarifa con que entro el ticket
    publicToken: text("public_token"), // token del QR de pago en linea
    exitDeadline: timestamp("exit_deadline", { withTimezone: true }),
    lostTicket: integer("lost_ticket").default(0).notNull(),
    lostTicketNote: text("lost_ticket_note"),
    lostTicketEvidencePath: text("lost_ticket_evidence_path"),
    lostTicketEvidenceName: text("lost_ticket_evidence_name"),
    lostTicketByStaffId: integer("lost_ticket_by_staff_id"),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_visitor_tickets_tenant").on(t.tenantId),
    index("idx_visitor_tickets_branch_status").on(t.branchId, t.status, t.entryTime),
  ],
);

export const visitorTicketQuotes = pgTable(
  "visitor_ticket_quotes",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => visitorTickets.id),
    rateId: integer("rate_id").references(() => accessRates.id),
    rateLabel: text("rate_label").notNull(),
    ratePerHour: integer("rate_per_hour").default(0).notNull(),
    ratePerMinute: integer("rate_per_minute").default(0).notNull(),
    billingMode: text("billing_mode").default("per_minute").notNull(),
    gracePeriodMins: integer("grace_period_mins").default(0).notNull(),
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
    quoteTime: timestamp("quote_time", { withTimezone: true }).notNull(),
    durationMins: integer("duration_mins").default(0).notNull(),
    billableMins: integer("billable_mins").default(0).notNull(),
    subtotal: integer("subtotal").default(0).notNull(),
    discountAmount: integer("discount_amount").default(0).notNull(),
    total: integer("total").default(0).notNull(),
    roundingIncrement: integer("rounding_increment").default(100).notNull(),
    ratePlanId: integer("rate_plan_id"),
    breakdownJson: text("breakdown_json"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").default("quoted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_visitor_ticket_quotes_tenant").on(t.tenantId),
    index("idx_visitor_ticket_quotes_ticket").on(t.ticketId, t.createdAt),
  ],
);

export const visitorPasses = pgTable(
  "visitor_passes",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    rut: text("rut").notNull(),
    type: text("type").notNull(),
    reason: text("reason"),
    plate: text("plate"),
    phone: text("phone"),
    company: text("company"),
    authorizedBy: text("authorized_by"),
    associatedSpaceId: integer("associated_space_id").references(() => spaces.id),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
    qrToken: text("qr_token").notNull().unique(),
    status: text("status").default("waiting").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_visitor_passes_tenant").on(t.tenantId)],
);

export const accessLogs = pgTable(
  "access_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    clientId: integer("client_id").references(() => clients.id),
    visitorId: integer("visitor_id"),
    spaceId: integer("space_id").references(() => spaces.id),
    accessType: text("access_type").notNull(),
    status: text("status").default("authorized").notNull(),
    method: text("method").default("qr").notNull(),
    reason: text("reason"),
    authorizedBy: text("authorized_by"),
    plate: text("plate"),
    resolvedByAccessLogId: integer("resolved_by_access_log_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_access_logs_tenant").on(t.tenantId),
    index("idx_access_logs_branch_time").on(t.branchId, t.timestamp),
  ],
);

export const totems = pgTable(
  "totems",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    status: text("status").default("online").notNull(),
    maintenanceMode: integer("maintenance_mode").default(0).notNull(),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_totems_tenant").on(t.tenantId)],
);

// ============================================================================
// 6. Tareas, Documentos y Auditoria
// ============================================================================

export const operationalTasks = pgTable(
  "operational_tasks",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").default("general").notNull(),
    priority: text("priority").default("medium").notNull(),
    status: text("status").default("open").notNull(),
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedNote: text("completed_note"),
    createdByStaffId: integer("created_by_staff_id").references(() => staff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_operational_tasks_tenant").on(t.tenantId),
    index("idx_operational_tasks_status").on(t.status, t.dueDate),
  ],
);

export const guardShiftLogEntries = pgTable(
  "guard_shift_log_entries",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shiftLogId: integer("shift_log_id")
      .notNull()
      .references(() => guardShiftLogs.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    taskId: integer("task_id").references(() => operationalTasks.id),
    category: text("category").notNull(),
    priority: text("priority").default("medium").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    relatedSpaceId: integer("related_space_id").references(() => spaces.id),
    relatedAccessLogId: integer("related_access_log_id").references(() => accessLogs.id),
    followUpRequired: integer("follow_up_required").default(0).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_guard_shift_entries_tenant").on(t.tenantId),
    index("idx_guard_shift_entries_shift").on(t.shiftLogId, t.createdAt),
  ],
);

export const shiftLogEntryAttachments = pgTable(
  "shift_log_entry_attachments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shiftLogEntryId: integer("shift_log_entry_id")
      .notNull()
      .references(() => guardShiftLogEntries.id),
    staffId: integer("staff_id").references(() => staff.id),
    label: text("label"),
    filePath: text("file_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_shift_entry_attachments_tenant_entry").on(t.tenantId, t.shiftLogEntryId, t.createdAt)],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: integer("task_id")
      .notNull()
      .references(() => operationalTasks.id),
    staffId: integer("staff_id").references(() => staff.id),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_task_comments_tenant_task").on(t.tenantId, t.taskId, t.createdAt)],
);

export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    taskId: integer("task_id")
      .notNull()
      .references(() => operationalTasks.id),
    commentId: integer("comment_id").references(() => taskComments.id),
    staffId: integer("staff_id").references(() => staff.id),
    label: text("label"),
    filePath: text("file_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_task_attachments_tenant_task").on(t.tenantId, t.taskId, t.createdAt)],
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    entityType: text("entity_type").notNull(), // client | contract | payment
    entityId: integer("entity_id").notNull(),
    label: text("label").notNull(),
    documentType: text("document_type").default("other").notNull(),
    status: text("status").default("received").notNull(),
    expiresAt: date("expires_at"),
    notes: text("notes"),
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id),
    nextActionAt: date("next_action_at"),
    reviewedByStaffId: integer("reviewed_by_staff_id").references(() => staff.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    filePath: text("file_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_documents_tenant").on(t.tenantId),
    index("idx_documents_entity").on(t.entityType, t.entityId),
    index("idx_documents_follow_up").on(t.status, t.nextActionAt, t.assignedStaffId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    staffId: integer("staff_id").references(() => staff.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: text("metadata"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_audit_events_tenant").on(t.tenantId),
    index("idx_audit_events_created_at").on(t.createdAt),
    index("idx_audit_events_entity").on(t.entityType, t.entityId),
  ],
);

/**
 * Lista canonica de todas las tablas de negocio que llevan tenant_id y deben
 * tener Row Level Security (RLS + FORCE RLS) activo en PostgreSQL.
 * Excluye tablas globales de plataforma (`tenants`, `plans`, `staff`, `auth_sessions`,
 * `staff_access_events`, `tenant_memberships`, `subscriptions`).
 */

// ============================================================================
// Facturacion electronica (DTE / SII) - server/modules/dte
// ============================================================================

export const dteSettings = pgTable("dte_settings", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenants.id),
  environment: text("environment").default("certificacion").notNull(), // certificacion | produccion
  status: text("status").default("unconfigured").notNull(), // unconfigured | testing | certified | production
  rutEmisor: text("rut_emisor"),
  razonSocial: text("razon_social"),
  giro: text("giro"),
  actecoJson: text("acteco_json"),
  direccion: text("direccion"),
  comuna: text("comuna"),
  ciudad: text("ciudad"),
  codigoSucursalSii: integer("codigo_sucursal_sii"),
  resolucionNumero: integer("resolucion_numero"),
  resolucionFecha: date("resolucion_fecha", { mode: "string" }),
  rutEnvia: text("rut_envia"),
  siiUnidad: text("sii_unidad"),
  autoEmitBoleta: integer("auto_emit_boleta").default(1).notNull(),
  liveSince: timestamp("live_since", { withTimezone: true }),
  connectionOk: integer("connection_ok"),
  connectionCheckedAt: timestamp("connection_checked_at", { withTimezone: true }),
  connectionMessage: text("connection_message"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const dteCertificates = pgTable(
  "dte_certificates",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    pfxEncrypted: text("pfx_encrypted").notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    subjectRut: text("subject_rut"),
    subjectName: text("subject_name"),
    issuer: text("issuer"),
    serialNumber: text("serial_number"),
    fingerprint: text("fingerprint").notNull(),
    // Fechas ISO 8601 tal como las entrega el certificado.
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    active: integer("active").default(1).notNull(),
    uploadedByStaffId: integer("uploaded_by_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_dte_certificates_fingerprint").on(t.tenantId, t.fingerprint),
    index("idx_dte_certificates_tenant_active").on(t.tenantId, t.active),
  ],
);

export const dteCafs = pgTable(
  "dte_cafs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    environment: text("environment").notNull(),
    dteType: integer("dte_type").notNull(),
    folioFrom: integer("folio_from").notNull(),
    folioTo: integer("folio_to").notNull(),
    nextFolio: integer("next_folio").notNull(),
    cafXmlEncrypted: text("caf_xml_encrypted").notNull(),
    authorizedAt: date("authorized_at", { mode: "string" }).notNull(),
    expiresAt: date("expires_at", { mode: "string" }),
    status: text("status").default("active").notNull(), // active | exhausted | expired | voided
    uploadedByStaffId: integer("uploaded_by_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_dte_cafs_range").on(t.tenantId, t.environment, t.dteType, t.folioFrom),
    index("idx_dte_cafs_lookup").on(t.tenantId, t.environment, t.dteType, t.status),
  ],
);

export const dteDocuments = pgTable(
  "dte_documents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    branchId: integer("branch_id"),
    environment: text("environment").notNull(),
    dteType: integer("dte_type").notNull(),
    folio: integer("folio").notNull(),
    cafId: integer("caf_id").references(() => dteCafs.id),
    issuedAt: date("issued_at", { mode: "string" }).notNull(),
    // Receptor opcional: la boleta de estacionamiento se emite sin cliente.
    clientId: integer("client_id"),
    receptorRut: text("receptor_rut"),
    receptorRazon: text("receptor_razon"),
    receptorGiro: text("receptor_giro"),
    receptorDireccion: text("receptor_direccion"),
    receptorComuna: text("receptor_comuna"),
    neto: integer("neto").default(0).notNull(),
    exento: integer("exento").default(0).notNull(),
    iva: integer("iva").default(0).notNull(),
    total: integer("total").notNull(),
    itemsJson: text("items_json").notNull(),
    referencesJson: text("references_json"),
    dteXml: text("dte_xml"),
    tedXml: text("ted_xml"),
    pdfKey: text("pdf_key"),
    sourceType: text("source_type"), // ticket | payment | manual | subscription | credit_note
    sourceId: text("source_id"),
    status: text("status").default("draft").notNull(),
    statusDetail: text("status_detail"),
    envioId: integer("envio_id"),
    trackId: text("track_id"),
    createdByStaffId: integer("created_by_staff_id"),
    sendAttempts: integer("send_attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_dte_documents_folio").on(t.tenantId, t.environment, t.dteType, t.folio),
    uniqueIndex("uq_dte_documents_source")
      .on(t.tenantId, t.environment, t.sourceType, t.sourceId, t.dteType)
      .where(sql`${t.sourceType} IS NOT NULL AND ${t.sourceId} IS NOT NULL`),
    index("idx_dte_documents_status").on(t.tenantId, t.status, t.createdAt),
  ],
);

export const dteEnvios = pgTable(
  "dte_envios",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    environment: text("environment").notNull(),
    kind: text("kind").notNull(), // EnvioDTE | EnvioBOLETA
    xmlSigned: text("xml_signed").notNull(),
    documentCount: integer("document_count").notNull(),
    trackId: text("track_id"),
    status: text("status").default("pending").notNull(),
    siiStatusCode: text("sii_status_code"),
    siiResponseJson: text("sii_response_json"),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_dte_envios_pending").on(t.status, t.nextAttemptAt)],
);

export const dteEvents = pgTable(
  "dte_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    documentId: integer("document_id").references(() => dteDocuments.id),
    envioId: integer("envio_id").references(() => dteEnvios.id),
    eventType: text("event_type").notNull(),
    status: text("status"),
    message: text("message"),
    payloadJson: text("payload_json"),
    staffId: integer("staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_dte_events_document").on(t.tenantId, t.documentId, t.createdAt)],
);


// ============================================================================
// Tarifas versionadas y convenios - server/modules/tickets
// ============================================================================

export const ratePlans = pgTable(
  "rate_plans",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    // Todas las versiones de una tarifa comparten group_id; el ticket guarda el id de la version con que entro.
    groupId: integer("group_id").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    name: text("name").notNull(),
    vehicleType: text("vehicle_type").default("all").notNull(), // all | car | moto | truck
    mode: text("mode").default("per_minute").notNull(), // per_minute | elapsed_blocks
    graceMins: integer("grace_mins").default(0).notNull(),
    dailyCap: integer("daily_cap"),
    firstBlockMinutes: integer("first_block_minutes"),
    blockMinutes: integer("block_minutes"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    status: text("status").default("active").notNull(), // active | archived
    changeNote: text("change_note"),
    createdByStaffId: integer("created_by_staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_rate_plans_tenant_status").on(t.tenantId, t.status),
    index("idx_rate_plans_group").on(t.tenantId, t.groupId, t.version),
  ],
);

export const rateRules = pgTable(
  "rate_rules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    planId: integer("plan_id").notNull().references(() => ratePlans.id),
    sortOrder: integer("sort_order").default(0).notNull(),
    weekdays: text("weekdays"), // "1,2,3,4,5" (1 = lunes ... 7 = domingo); null = todos
    fromTime: text("from_time").notNull(),
    toTime: text("to_time").notNull(),
    priority: integer("priority").default(0).notNull(),
    pricePerMinute: integer("price_per_minute"),
    firstBlockPrice: integer("first_block_price"),
    blockPrice: integer("block_price"),
  },
  (t) => [index("idx_rate_rules_plan").on(t.planId, t.sortOrder)],
);

export const agreements = pgTable(
  "agreements",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    branchId: integer("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    kind: text("kind").notNull(), // free_minutes | percent | fixed
    value: integer("value").notNull(),
    capAmount: integer("cap_amount"),
    status: text("status").default("active").notNull(), // active | inactive
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("uq_agreements_code").on(t.code)],
);

export const ticketValidations = pgTable(
  "ticket_validations",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    ticketId: integer("ticket_id").notNull().references(() => visitorTickets.id),
    agreementId: integer("agreement_id").notNull().references(() => agreements.id),
    validatedBy: text("validated_by").default("merchant").notNull(), // merchant | staff
    staffId: integer("staff_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ticket_validations_ticket_agreement").on(t.ticketId, t.agreementId),
    index("idx_ticket_validations_ticket").on(t.ticketId),
  ],
);

export const paymentSettings = pgTable(
  "payment_settings",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    provider: text("provider").notNull(), // webpay | mock
    environment: text("environment").default("integration").notNull(), // integration | production
    commerceCode: text("commerce_code"),
    apiSecretEncrypted: text("api_secret_encrypted"),
    enabled: integer("enabled").default(0).notNull(),
    exitWindowMins: integer("exit_window_mins").default(15).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("uq_payment_settings_tenant_provider").on(t.tenantId, t.provider)],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    publicId: text("public_id").notNull(),
    kind: text("kind").notNull(), // visitor_ticket | receivable
    ticketId: integer("ticket_id").references(() => visitorTickets.id),
    paymentId: integer("payment_id").references(() => payments.id),
    provider: text("provider").notNull(),
    status: text("status").default("created").notNull(), // created | pending | paid | failed | cancelled | expired | refunded
    amount: integer("amount").notNull(),
    currency: text("currency").default("CLP").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    buyOrder: text("buy_order").notNull(),
    providerToken: text("provider_token"),
    authorizationCode: text("authorization_code"),
    cardLast4: text("card_last4"),
    quoteId: integer("quote_id"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_payment_intents_public_id").on(t.publicId),
    uniqueIndex("uq_payment_intents_tenant_idem").on(t.tenantId, t.idempotencyKey),
    uniqueIndex("uq_payment_intents_token").on(t.provider, t.providerToken),
    index("idx_payment_intents_ticket").on(t.ticketId, t.status),
    index("idx_payment_intents_payment").on(t.paymentId, t.status),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().references(() => tenants.id),
    intentId: integer("intent_id").notNull().references(() => paymentIntents.id),
    kind: text("kind").notNull(),
    externalId: text("external_id"),
    payloadJson: text("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_payment_events_external").on(t.externalId),
    index("idx_payment_events_intent").on(t.intentId),
  ],
);

export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: serial("id").primaryKey(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    template: text("template").notNull(),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    tenantRef: integer("tenant_ref"), // referencia informativa; tabla de plataforma, sin RLS
    dedupeKey: text("dedupe_key"),
    status: text("status").default("queued").notNull(), // queued | sent | failed | skipped
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    lastError: text("last_error"),
    providerId: text("provider_id"),
    transport: text("transport"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_mail_outbox_dedupe").on(t.dedupeKey),
    index("idx_mail_outbox_due").on(t.status, t.nextAttemptAt),
    index("idx_mail_outbox_recipient").on(t.toEmail, t.template, t.createdAt),
  ],
);

export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subjectType: text("subject_type").notNull(), // staff | client | visitor
    subjectId: integer("subject_id"),
    subjectIdentifier: text("subject_identifier").notNull(),
    purpose: text("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    granted: integer("granted").default(1).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_privacy_consents_tenant_subject").on(t.tenantId, t.subjectIdentifier, t.createdAt),
    index("idx_privacy_consents_purpose").on(t.tenantId, t.purpose),
  ],
);

export const ufRates = pgTable("uf_rates", {
  rateDate: date("rate_date").primaryKey(),
  valueClp: doublePrecision("value_clp").notNull(),
  source: text("source").default("mindicador.cl").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const oneclickInscriptions = pgTable(
  "oneclick_inscriptions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    username: text("username").notNull(),
    email: text("email").notNull(),
    tbkUser: text("tbk_user"),
    authorizationCode: text("authorization_code"),
    cardType: text("card_type"),
    cardLast4: text("card_last4"),
    status: text("status").default("pending").notNull(), // pending | active | revoked
    token: text("token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_oneclick_inscriptions_tenant_status").on(t.tenantId, t.status),
    index("idx_oneclick_inscriptions_token").on(t.token),
  ],
);

export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subscriptionId: integer("subscription_id").references(() => subscriptions.id),
    planId: integer("plan_id").references(() => plans.id),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    ufDate: date("uf_date").notNull(),
    ufValueClp: doublePrecision("uf_value_clp").notNull(),
    amountUfCentis: integer("amount_uf_centis").notNull(),
    amountClp: integer("amount_clp").notNull(),
    status: text("status").default("pending").notNull(), // pending | paid | failed
    buyOrder: text("buy_order").notNull().unique(),
    authorizationCode: text("authorization_code"),
    dteDocumentId: integer("dte_document_id"),
    dteFolio: integer("dte_folio"),
    dteStatus: text("dte_status"),
    errorMessage: text("error_message"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_subscription_invoices_tenant_created").on(t.tenantId, t.createdAt)],
);

export const TENANT_SCOPED_TABLES = [
  "tenant_settings",
  "branches",
  "clients",
  "vehicles",
  "spaces",
  "space_status_history",
  "space_maps",
  "space_map_regions",
  "contracts",
  "payments",
  "bank_movements",
  "payment_allocations",
  "payment_adjustments",
  "collection_actions",
  "expenses",
  "financial_budgets",
  "monthly_finance_closures",
  "invoices",
  "sii_events",
  "access_rates",
  "guard_shift_logs",
  "guard_shift_log_entries",
  "shift_log_entry_attachments",
  "cash_sessions",
  "cash_movements",
  "cash_session_closures",
  "visitor_tickets",
  "visitor_ticket_quotes",
  "visitor_passes",
  "access_logs",
  "totems",
  "operational_tasks",
  "task_comments",
  "task_attachments",
  "documents",
  "audit_events",
  "dte_settings",
  "dte_certificates",
  "dte_cafs",
  "dte_documents",
  "dte_envios",
  "dte_events",
  "rate_plans",
  "rate_rules",
  "agreements",
  "ticket_validations",
  "payment_settings",
  "payment_intents",
  "payment_events",
  "privacy_consents",
  "oneclick_inscriptions",
  "subscription_invoices",
] as const;

