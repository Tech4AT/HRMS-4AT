/**
 * In-memory mock backend for local frontend work while the Django backend
 * (docs/TASKS.md) doesn't exist yet. Active only when `MOCK_AUTH=true` (see
 * mock-auth.ts) — `proxyToBackend` in proxy.ts routes every request here
 * instead of calling `BACKEND_API_URL`. State lives for the life of the dev
 * server process and resets on restart.
 *
 * Delete this file (and the MOCK_AUTH branch in proxy.ts) once the real
 * backend's endpoints are live.
 */

type MockResult = { status: number; body: any };

let idSeq = 1000;
function nextId(prefix: string) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ok<T>(data: T, status = 200): MockResult {
  return { status, body: { success: true, data } };
}

function fail(message: string, status = 400): MockResult {
  return { status, body: { success: false, error: { message } } };
}

/* ============================== Leave ============================== */

const LEAVE_TYPES = [
  {
    id: 'lt-annual',
    name: 'Annual Leave',
    code: 'AL',
    annual_allocation: 20,
    carry_forward_limit: 5,
    requires_approval: true,
    is_paid: true,
    description: null,
    status: 'active',
  },
  {
    id: 'lt-sick',
    name: 'Sick Leave',
    code: 'SL',
    annual_allocation: 10,
    carry_forward_limit: 0,
    requires_approval: true,
    is_paid: true,
    description: null,
    status: 'active',
  },
  {
    id: 'lt-casual',
    name: 'Casual Leave',
    code: 'CL',
    annual_allocation: 6,
    carry_forward_limit: 0,
    requires_approval: true,
    is_paid: true,
    description: null,
    status: 'active',
  },
];

const LEAVE_BALANCES = LEAVE_TYPES.map((t) => {
  const used = t.code === 'AL' ? 4 : t.code === 'SL' ? 1 : 0;
  const pending = t.code === 'AL' ? 2 : 0;
  return {
    id: `bal-${t.id}`,
    leave_type_id: t.id,
    financial_year: '2026',
    opening_balance: 0,
    allocated: t.annual_allocation,
    used,
    pending,
    carry_forward: 0,
    lapsed: 0,
    entitled: t.annual_allocation,
    available: t.annual_allocation - used - pending,
  };
});

let leaveRequests: any[] = [
  {
    id: 'lr-1001',
    employee_id: 'mock-user-1',
    leave_type_id: 'lt-annual',
    start_date: '2026-08-10',
    end_date: '2026-08-11',
    duration_days: 2,
    half_day_option: 'full_day',
    reason: 'Family trip',
    status: 'approved',
    approver_id: 'mock-manager-1',
    approved_at: '2026-08-01T09:00:00.000Z',
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-07-28T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    leave_type_name: 'Annual Leave',
    leave_type_code: 'AL',
    employee_name: 'Demo User',
    approver_name: 'Alex Manager',
  },
  {
    id: 'lr-1002',
    employee_id: 'mock-user-1',
    leave_type_id: 'lt-annual',
    start_date: '2026-09-25',
    end_date: '2026-09-26',
    duration_days: 2,
    half_day_option: 'full_day',
    reason: 'Personal',
    status: 'submitted',
    approver_id: 'mock-manager-1',
    approved_at: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-15T09:00:00.000Z',
    leave_type_name: 'Annual Leave',
    leave_type_code: 'AL',
    employee_name: 'Demo User',
    approver_name: null,
  },
  // Other employees' requests - not "mine", but visible to an approver
  // (mock-user-1 holds leave.approve + org scope). GET /leave/requests
  // filters these out for the caller's own list.
  {
    id: 'lr-2001',
    employee_id: 'emp-aditi',
    leave_type_id: 'lt-sick',
    start_date: '2026-09-22',
    end_date: '2026-09-22',
    duration_days: 1,
    half_day_option: 'full_day',
    reason: 'Not feeling well',
    status: 'submitted',
    approver_id: 'mock-user-1',
    approved_at: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    leave_type_name: 'Sick Leave',
    leave_type_code: 'SL',
    employee_name: 'Aditi Sharma',
    approver_name: null,
  },
  {
    id: 'lr-2002',
    employee_id: 'emp-nikhil',
    leave_type_id: 'lt-casual',
    start_date: '2026-09-10',
    end_date: '2026-09-10',
    duration_days: 1,
    half_day_option: 'full_day',
    reason: 'Personal errand',
    status: 'approved',
    approver_id: 'mock-user-1',
    approved_at: '2026-09-09T10:00:00.000Z',
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-08T09:00:00.000Z',
    updated_at: '2026-09-09T10:00:00.000Z',
    leave_type_name: 'Casual Leave',
    leave_type_code: 'CL',
    employee_name: 'Nikhil Kommineni',
    approver_name: 'Demo User',
  },
  {
    id: 'lr-2003',
    employee_id: 'emp-marcus',
    leave_type_id: 'lt-annual',
    start_date: '2026-09-05',
    end_date: '2026-09-08',
    duration_days: 4,
    half_day_option: 'full_day',
    reason: 'Vacation',
    status: 'rejected',
    approver_id: 'mock-user-1',
    approved_at: null,
    rejection_reason: 'Sprint deadline conflict',
    cancelled_at: null,
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-02T09:00:00.000Z',
    leave_type_name: 'Annual Leave',
    leave_type_code: 'AL',
    employee_name: 'Marcus Kinsley',
    approver_name: 'Demo User',
  },
];

function handleLeave(method: string, segments: string[], _query: URLSearchParams, body: any): MockResult {
  // segments excludes the leading "leave"
  if (method === 'GET' && segments.length === 1 && segments[0] === 'types') {
    return ok(LEAVE_TYPES);
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'balance') {
    return ok(LEAVE_BALANCES);
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'requests') {
    return ok(leaveRequests.filter((r) => r.employee_id === 'mock-user-1'));
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'requests') {
    const created = {
      id: nextId('lr'),
      employee_id: 'mock-user-1',
      leave_type_id: body.leave_type_id,
      start_date: body.start_date,
      end_date: body.end_date,
      duration_days: body.half_day_option && body.half_day_option !== 'full_day' ? 0.5 : 1,
      half_day_option: body.half_day_option ?? 'full_day',
      reason: body.reason ?? null,
      status: 'submitted',
      approver_id: 'mock-manager-1',
      approved_at: null,
      rejection_reason: null,
      cancelled_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      leave_type_name: LEAVE_TYPES.find((t) => t.id === body.leave_type_id)?.name ?? 'Leave',
      leave_type_code: LEAVE_TYPES.find((t) => t.id === body.leave_type_id)?.code ?? null,
      employee_name: 'Demo User',
      approver_name: null,
    };
    leaveRequests = [created, ...leaveRequests];
    return ok(created, 201);
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'requests' && segments[2] === 'cancel') {
    const id = segments[1];
    const req = leaveRequests.find((r) => r.id === id);
    if (!req) return fail('Leave request not found', 404);
    req.status = 'cancelled';
    req.cancelled_at = new Date().toISOString();
    return ok(req);
  }
  if (method === 'PUT' && segments.length === 3 && segments[0] === 'requests' && segments[2] === 'approve') {
    const id = segments[1];
    const req = leaveRequests.find((r) => r.id === id);
    if (!req) return fail('Leave request not found', 404);
    if (body.approve) {
      req.status = 'approved';
      req.approved_at = new Date().toISOString();
      req.approver_name = 'Demo User';
      req.approver_remarks = body.remarks ?? null;
    } else {
      req.status = 'rejected';
      req.rejection_reason = body.rejection_reason ?? null;
      req.approver_name = 'Demo User';
      req.approver_remarks = body.remarks ?? null;
    }
    return ok(req);
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'approvals' && segments[1] === 'pending') {
    return ok(leaveRequests.filter((r) => r.employee_id !== 'mock-user-1' && r.status === 'submitted'));
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'approvals' && segments[1] === 'history') {
    return ok(
      leaveRequests.filter(
        (r) => r.employee_id !== 'mock-user-1' && (r.status === 'approved' || r.status === 'rejected'),
      ),
    );
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'holidays') {
    // Sourced from the org calendar (see the Calendar Management admin
    // section) so an HR admin's holiday changes show up here too.
    return ok(
      calendarEntries
        .filter((e) => e.type === 'holiday')
        .map((e) => ({
          id: e.id,
          name: e.name,
          holiday_date: e.date,
          is_optional: false,
          description: e.description,
        })),
    );
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'calendar') {
    return ok(leaveRequests.filter((r) => r.status === 'approved'));
  }
  return ok([]);
}

/* ============================== Attendance ============================== */

const attendanceState: {
  checkIn: string | null;
  checkOut: string | null;
  breakStart: string | null;
  breakMinutes: number;
} = {
  checkIn: null,
  checkOut: null,
  breakStart: null,
  breakMinutes: 0,
};

/** Break time elapsed so far today, including any break in progress. */
function currentBreakMinutes(): number {
  if (!attendanceState.breakStart) return attendanceState.breakMinutes;
  const ongoing = Math.round((Date.now() - new Date(attendanceState.breakStart).getTime()) / 60000);
  return attendanceState.breakMinutes + ongoing;
}

let attendanceRequests: any[] = [
  {
    id: 'ar-3001',
    employee_id: 'mock-user-1',
    request_type: 'wfh',
    start_date: '2026-09-18',
    end_date: '2026-09-18',
    reason: 'Home internet installation',
    status: 'approved',
    approver_id: 'mock-manager-1',
    approved_at: '2026-09-16T09:00:00.000Z',
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-16T09:00:00.000Z',
    employee_name: 'Demo User',
    approver_name: 'Alex Manager',
  },
  // Other employees' requests - not "mine", but visible to an approver
  // (mock-user-1 holds attendance.approve + org scope). GET /attendance/requests
  // filters these out for the caller's own list.
  {
    id: 'ar-4001',
    employee_id: 'emp-nikhil',
    request_type: 'regularisation',
    start_date: '2026-09-19',
    end_date: '2026-09-19',
    reason: 'Forgot to clock in',
    status: 'submitted',
    approver_id: 'mock-user-1',
    approved_at: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-20T08:00:00.000Z',
    updated_at: '2026-09-20T08:00:00.000Z',
    employee_name: 'Nikhil Kommineni',
    approver_name: null,
  },
  {
    id: 'ar-4002',
    employee_id: 'emp-sarah',
    request_type: 'wfh',
    start_date: '2026-09-23',
    end_date: '2026-09-23',
    reason: 'Doctor visit nearby',
    status: 'submitted',
    approver_id: 'mock-user-1',
    approved_at: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-20T09:00:00.000Z',
    updated_at: '2026-09-20T09:00:00.000Z',
    employee_name: 'Sarah Jenkins',
    approver_name: null,
  },
  {
    id: 'ar-5001',
    employee_id: 'emp-kiran',
    request_type: 'wfh',
    start_date: '2026-09-11',
    end_date: '2026-09-12',
    reason: 'Home repairs',
    status: 'approved',
    approver_id: 'mock-user-1',
    approved_at: '2026-09-10T09:00:00.000Z',
    rejection_reason: null,
    cancelled_at: null,
    created_at: '2026-09-09T09:00:00.000Z',
    updated_at: '2026-09-10T09:00:00.000Z',
    employee_name: 'Kiran Vasvani',
    approver_name: 'Demo User',
  },
  {
    id: 'ar-5002',
    employee_id: 'emp-david',
    request_type: 'regularisation',
    start_date: '2026-09-08',
    end_date: '2026-09-08',
    reason: 'Biometric device offline',
    status: 'rejected',
    approver_id: 'mock-user-1',
    approved_at: null,
    rejection_reason: 'No supporting evidence attached',
    cancelled_at: null,
    created_at: '2026-09-08T18:00:00.000Z',
    updated_at: '2026-09-09T09:00:00.000Z',
    employee_name: 'David Chen',
    approver_name: 'Demo User',
  },
];

/* ============================== Org Calendar ============================== */

// HR-admin-managed, org-wide calendar: holidays and special events (one-off,
// by date) plus WFH days - either a specific date or a recurring weekday
// rule (e.g. "every Wednesday"). Every employee's attendance view reads from
// this same state, which is exactly what makes it "apply to everyone."

type CalendarEntryType = 'holiday' | 'wfh' | 'event';

interface CalendarEntry {
  id: string;
  type: CalendarEntryType;
  date: string; // YYYY-MM-DD
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RecurringWfhRule {
  id: string;
  weekday: number; // 0 = Sunday ... 6 = Saturday
  label: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let calendarEntries: CalendarEntry[] = [
  {
    id: 'cal-1',
    type: 'holiday',
    date: '2026-10-20',
    name: 'Diwali',
    description: null,
    created_at: '2026-01-05T09:00:00.000Z',
    updated_at: '2026-01-05T09:00:00.000Z',
  },
  {
    id: 'cal-2',
    type: 'holiday',
    date: '2026-01-26',
    name: 'Republic Day',
    description: null,
    created_at: '2026-01-05T09:00:00.000Z',
    updated_at: '2026-01-05T09:00:00.000Z',
  },
  {
    id: 'cal-3',
    type: 'event',
    date: '2026-09-25',
    name: 'Company Townhall',
    description: 'All-hands update from leadership, 4pm in the main auditorium.',
    created_at: '2026-09-10T09:00:00.000Z',
    updated_at: '2026-09-10T09:00:00.000Z',
  },
  {
    id: 'cal-4',
    type: 'wfh',
    date: '2026-09-30',
    name: 'Office AC Maintenance',
    description: 'Building maintenance - everyone works from home for the day.',
    created_at: '2026-09-18T09:00:00.000Z',
    updated_at: '2026-09-18T09:00:00.000Z',
  },
];

let recurringWfhRules: RecurringWfhRule[] = [];

function calendarInfoFor(dateStr: string, dow: number) {
  const holiday = calendarEntries.find((e) => e.type === 'holiday' && e.date === dateStr);
  const events = calendarEntries
    .filter((e) => e.type === 'event' && e.date === dateStr)
    .map((e) => ({ name: e.name, description: e.description }));
  const oneOffWfh = calendarEntries.find((e) => e.type === 'wfh' && e.date === dateStr);
  const recurringWfhRule = recurringWfhRules.find((r) => r.active && r.weekday === dow);
  return {
    holiday,
    events,
    isWfhDay: Boolean(oneOffWfh) || Boolean(recurringWfhRule),
    wfhNote: oneOffWfh?.name ?? recurringWfhRule?.label ?? null,
    wfhDescription: oneOffWfh?.description ?? null,
  };
}

function handleCalendar(method: string, segments: string[], _query: URLSearchParams, body: any): MockResult {
  // segments excludes the leading "calendar"
  if (method === 'GET' && segments.length === 1 && segments[0] === 'entries') {
    const from = _query.get('from');
    const to = _query.get('to');
    const type = _query.get('type');
    let list = [...calendarEntries];
    if (from) list = list.filter((e) => e.date >= from);
    if (to) list = list.filter((e) => e.date <= to);
    if (type) list = list.filter((e) => e.type === type);
    return ok(list.sort((a, b) => a.date.localeCompare(b.date)));
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'entries') {
    if (!body.type || !body.date || !body.name) return fail('type, date and name are required', 422);
    const created: CalendarEntry = {
      id: nextId('cal'),
      type: body.type,
      date: body.date,
      name: body.name,
      description: body.description ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    calendarEntries = [...calendarEntries, created];
    return ok(created, 201);
  }
  if (method === 'PUT' && segments.length === 2 && segments[0] === 'entries') {
    const entry = calendarEntries.find((e) => e.id === segments[1]);
    if (!entry) return fail('Calendar entry not found', 404);
    if (body.type) entry.type = body.type;
    if (body.date) entry.date = body.date;
    if (body.name) entry.name = body.name;
    if (body.description !== undefined) entry.description = body.description;
    entry.updated_at = new Date().toISOString();
    return ok(entry);
  }
  if (method === 'DELETE' && segments.length === 2 && segments[0] === 'entries') {
    const before = calendarEntries.length;
    calendarEntries = calendarEntries.filter((e) => e.id !== segments[1]);
    if (calendarEntries.length === before) return fail('Calendar entry not found', 404);
    return ok(null);
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'recurring-wfh') {
    return ok(recurringWfhRules);
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'recurring-wfh') {
    if (body.weekday == null) return fail('weekday is required', 422);
    const created: RecurringWfhRule = {
      id: nextId('wfh-rule'),
      weekday: Number(body.weekday),
      label: body.label || `Every ${WEEKDAY_NAMES[Number(body.weekday)]}`,
      active: body.active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    recurringWfhRules = [...recurringWfhRules, created];
    return ok(created, 201);
  }
  if (method === 'PATCH' && segments.length === 2 && segments[0] === 'recurring-wfh') {
    const rule = recurringWfhRules.find((r) => r.id === segments[1]);
    if (!rule) return fail('Recurring WFH rule not found', 404);
    if (body.weekday != null) rule.weekday = Number(body.weekday);
    if (body.label) rule.label = body.label;
    if (body.active != null) rule.active = Boolean(body.active);
    rule.updated_at = new Date().toISOString();
    return ok(rule);
  }
  if (method === 'DELETE' && segments.length === 2 && segments[0] === 'recurring-wfh') {
    const before = recurringWfhRules.length;
    recurringWfhRules = recurringWfhRules.filter((r) => r.id !== segments[1]);
    if (recurringWfhRules.length === before) return fail('Recurring WFH rule not found', 404);
    return ok(null);
  }
  return ok([]);
}

const STANDARD_WORKDAY_MINUTES = 8 * 60;

/** Deterministic pseudo-random-but-stable day view, seeded by the date string. */
function dayViewFor(dateStr: string): any {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  const isToday = dateStr === todayISO();
  const { holiday, events, isWfhDay, wfhNote, wfhDescription } = calendarInfoFor(dateStr, dow);

  if (dow === 0 || dow === 6) {
    return {
      attendance_date: dateStr,
      status: 'weekend',
      check_in: null,
      check_out: null,
      working_minutes: null,
      late_minutes: null,
      early_leave_minutes: null,
      is_weekend: true,
      is_holiday: false,
      holiday_name: null,
      holiday_description: null,
      on_leave: false,
      leave_type_name: null,
      source: null,
      notes: null,
      record_id: null,
      is_wfh_day: false,
      wfh_note: null,
      wfh_description: null,
      events,
    };
  }

  if (holiday) {
    return {
      attendance_date: dateStr,
      status: 'holiday',
      check_in: null,
      check_out: null,
      working_minutes: null,
      late_minutes: null,
      early_leave_minutes: null,
      is_weekend: false,
      is_holiday: true,
      holiday_name: holiday.name,
      holiday_description: holiday.description,
      on_leave: false,
      leave_type_name: null,
      source: null,
      notes: null,
      record_id: null,
      is_wfh_day: false,
      wfh_note: null,
      wfh_description: null,
      events,
    };
  }

  if (isToday) {
    const checkIn = attendanceState.checkIn;
    const checkOut = attendanceState.checkOut;
    const breakMinutes = currentBreakMinutes();
    const workingMinutes =
      checkIn && checkOut
        ? Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000) - breakMinutes)
        : null;
    const standardEnd = new Date(d);
    standardEnd.setHours(18, 0, 0, 0);
    const checkOutDate = checkOut ? new Date(checkOut) : null;
    return {
      attendance_date: dateStr,
      status: checkIn ? 'present' : 'not_marked',
      check_in: checkIn,
      check_out: checkOut,
      working_minutes: workingMinutes,
      late_minutes: 0,
      early_leave_minutes: checkOutDate && checkOutDate < standardEnd
        ? Math.round((standardEnd.getTime() - checkOutDate.getTime()) / 60000)
        : 0,
      overtime_minutes: workingMinutes != null ? Math.max(0, workingMinutes - STANDARD_WORKDAY_MINUTES) : 0,
      is_weekend: false,
      is_holiday: false,
      holiday_name: null,
      holiday_description: null,
      on_leave: false,
      leave_type_name: null,
      source: checkIn ? 'web' : null,
      notes: null,
      record_id: checkIn ? 'rec-today' : null,
      on_break: Boolean(attendanceState.breakStart),
      break_minutes: breakMinutes,
      is_wfh_day: isWfhDay,
      wfh_note: wfhNote,
      wfh_description: wfhDescription,
      events,
    };
  }

  // Deterministic "history" for past weekdays: mostly present, occasionally
  // late, early-leaving, or working overtime.
  const dayNum = d.getDate();
  const late = dayNum % 6 === 0;
  const earlyLeave = dayNum % 7 === 0;
  const overtime = !earlyLeave && dayNum % 5 === 0;
  const checkInHour = late ? 9 : 9;
  const checkInMin = late ? 45 : String(dayNum).padStart(2, '0').charCodeAt(1) % 20;
  const checkIn = new Date(d);
  checkIn.setHours(checkInHour, checkInMin, 0, 0);
  const checkOut = new Date(d);
  if (earlyLeave) checkOut.setHours(17, 0, 0, 0);
  else if (overtime) checkOut.setHours(20, 0, 0, 0);
  else checkOut.setHours(18, 15, 0, 0);

  const workingMinutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000);
  const standardEnd = new Date(d);
  standardEnd.setHours(18, 0, 0, 0);

  return {
    attendance_date: dateStr,
    status: 'present',
    check_in: checkIn.toISOString(),
    check_out: checkOut.toISOString(),
    working_minutes: workingMinutes,
    late_minutes: late ? 30 : 0,
    early_leave_minutes: checkOut < standardEnd ? Math.round((standardEnd.getTime() - checkOut.getTime()) / 60000) : 0,
    overtime_minutes: Math.max(0, workingMinutes - STANDARD_WORKDAY_MINUTES),
    is_weekend: false,
    is_holiday: false,
    holiday_name: null,
    holiday_description: null,
    on_leave: false,
    leave_type_name: null,
    source: 'biometric',
    notes: null,
    record_id: `rec-${dateStr}`,
    is_wfh_day: isWfhDay,
    wfh_note: wfhNote,
    wfh_description: wfhDescription,
    events,
  };
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function resolveWindow(query: URLSearchParams): { from: string; to: string } {
  const from = query.get('from');
  const to = query.get('to');
  if (from && to) return { from, to };
  const today = todayISO();
  const d = new Date();
  d.setDate(d.getDate() - 29);
  const fallbackFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fallbackFrom, to: today };
}

function handleAttendanceRoot(query: URLSearchParams): MockResult {
  const { from, to } = resolveWindow(query);
  return ok(dateRange(from, to).map(dayViewFor));
}

function handleAttendance(method: string, segments: string[], query: URLSearchParams, body: any): MockResult {
  if (method === 'GET' && segments.length === 1 && segments[0] === 'today') {
    return ok(dayViewFor(todayISO()));
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'summary') {
    const { from, to } = resolveWindow(query);
    const days = dateRange(from, to).map(dayViewFor);
    const workingDays = days.filter((d) => d.status !== 'weekend' && d.status !== 'holiday');
    const presentDays = days.filter((d) => d.status === 'present');
    const lateDays = days.filter((d) => (d.late_minutes ?? 0) > 0);
    const earlyLeaveDays = days.filter((d) => (d.early_leave_minutes ?? 0) > 0);
    const totalMinutes = presentDays.reduce((s, d) => s + (d.working_minutes ?? 0), 0);
    const overtimeMinutes = presentDays.reduce((s, d) => s + (d.overtime_minutes ?? 0), 0);
    return ok({
      from,
      to,
      elapsed_days: days.length,
      total_days: days.length,
      weekend_days: days.filter((d) => d.status === 'weekend').length,
      holiday_days: days.filter((d) => d.status === 'holiday').length,
      working_days: workingDays.length,
      present_days: presentDays.length,
      leave_days: days.filter((d) => d.status === 'on_leave').length,
      absent_days: days.filter((d) => d.status === 'absent').length,
      late_days: lateDays.length,
      early_leave_days: earlyLeaveDays.length,
      total_working_minutes: totalMinutes,
      total_working_hours: Math.round((totalMinutes / 60) * 10) / 10,
      overtime_minutes: overtimeMinutes,
    });
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'check-in') {
    if (attendanceState.checkIn && !attendanceState.checkOut) {
      return fail('Already checked in', 409);
    }
    attendanceState.checkIn = new Date().toISOString();
    attendanceState.checkOut = null;
    attendanceState.breakStart = null;
    attendanceState.breakMinutes = 0;
    return ok({
      id: 'rec-today',
      organization_id: 'org-1',
      employee_id: 'mock-user-1',
      attendance_date: todayISO(),
      clock_in_time: attendanceState.checkIn,
      clock_out_time: null,
      working_minutes: null,
      late_minutes: 0,
      early_leave_minutes: null,
      status: 'present',
      source: 'web',
      notes: body?.notes ?? null,
      marked_by: null,
      created_at: attendanceState.checkIn,
      updated_at: attendanceState.checkIn,
    });
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'check-out') {
    if (!attendanceState.checkIn) return fail('Not checked in yet', 409);
    if (attendanceState.checkOut) return fail('Already checked out', 409);
    if (attendanceState.breakStart) return fail('End your break before checking out', 409);
    attendanceState.checkOut = new Date().toISOString();
    return ok({
      id: 'rec-today',
      organization_id: 'org-1',
      employee_id: 'mock-user-1',
      attendance_date: todayISO(),
      clock_in_time: attendanceState.checkIn,
      clock_out_time: attendanceState.checkOut,
      working_minutes: Math.max(
        0,
        Math.round(
          (new Date(attendanceState.checkOut).getTime() - new Date(attendanceState.checkIn).getTime()) / 60000,
        ) - attendanceState.breakMinutes,
      ),
      break_minutes: attendanceState.breakMinutes,
      late_minutes: 0,
      early_leave_minutes: null,
      status: 'present',
      source: 'web',
      notes: body?.notes ?? null,
      marked_by: null,
      created_at: attendanceState.checkIn,
      updated_at: attendanceState.checkOut,
    });
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'break-start') {
    if (!attendanceState.checkIn || attendanceState.checkOut) return fail('Not checked in', 409);
    if (attendanceState.breakStart) return fail('Break already in progress', 409);
    attendanceState.breakStart = new Date().toISOString();
    return ok(dayViewFor(todayISO()));
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'break-end') {
    if (!attendanceState.breakStart) return fail('No break in progress', 409);
    attendanceState.breakMinutes += Math.round(
      (Date.now() - new Date(attendanceState.breakStart).getTime()) / 60000,
    );
    attendanceState.breakStart = null;
    return ok(dayViewFor(todayISO()));
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'requests') {
    const type = query.get('type');
    const own = attendanceRequests.filter((r) => r.employee_id === 'mock-user-1');
    return ok(type ? own.filter((r) => r.request_type === type) : own);
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'requests') {
    const created = {
      id: nextId('ar'),
      employee_id: 'mock-user-1',
      request_type: body.request_type,
      start_date: body.start_date,
      end_date: body.end_date ?? body.start_date,
      reason: body.reason ?? null,
      status: 'submitted',
      approver_id: 'mock-manager-1',
      approved_at: null,
      rejection_reason: null,
      cancelled_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      employee_name: 'Demo User',
      approver_name: null,
    };
    attendanceRequests = [created, ...attendanceRequests];
    return ok(created, 201);
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'requests' && segments[2] === 'cancel') {
    const id = segments[1];
    const req = attendanceRequests.find((r) => r.id === id);
    if (!req) return fail('Request not found', 404);
    req.status = 'cancelled';
    req.cancelled_at = new Date().toISOString();
    return ok(req);
  }
  if (method === 'PATCH' && segments.length === 2 && segments[0] === 'requests') {
    const id = segments[1];
    const req = attendanceRequests.find((r) => r.id === id);
    if (!req) return fail('Request not found', 404);
    if (req.employee_id !== 'mock-user-1') return fail('Not allowed', 403);
    if (req.status !== 'submitted') return fail('Only a pending request can be edited', 409);
    if (req.request_type !== 'regularisation') return fail('Only regularisation requests can be edited', 409);
    if (body.start_date) {
      req.start_date = body.start_date;
      req.end_date = body.start_date;
    }
    if (body.reason !== undefined) req.reason = body.reason;
    req.updated_at = new Date().toISOString();
    return ok(req);
  }
  if (
    method === 'GET' &&
    segments.length === 3 &&
    segments[0] === 'requests' &&
    segments[1] === 'approvals' &&
    segments[2] === 'pending'
  ) {
    return ok(attendanceRequests.filter((r) => r.employee_id !== 'mock-user-1' && r.status === 'submitted'));
  }
  if (
    method === 'GET' &&
    segments.length === 3 &&
    segments[0] === 'requests' &&
    segments[1] === 'approvals' &&
    segments[2] === 'history'
  ) {
    return ok(
      attendanceRequests.filter(
        (r) => r.employee_id !== 'mock-user-1' && (r.status === 'approved' || r.status === 'rejected'),
      ),
    );
  }
  if (method === 'PUT' && segments.length === 3 && segments[0] === 'requests' && segments[2] === 'approve') {
    const id = segments[1];
    const req = attendanceRequests.find((r) => r.id === id);
    if (!req) return fail('Request not found', 404);
    if (body.approve) {
      req.status = 'approved';
      req.approved_at = new Date().toISOString();
      req.approver_name = 'Demo User';
      req.approver_remarks = body.remarks ?? null;
    } else {
      req.status = 'rejected';
      req.rejection_reason = body.rejection_reason ?? null;
      req.approver_name = 'Demo User';
      req.approver_remarks = body.remarks ?? null;
    }
    return ok(req);
  }
  return ok([]);
}

/* ============================== dispatcher ============================== */

/**
 * `path` is what proxyToBackend receives from each route handler: a
 * leading-slash path (no /api/v1 prefix) plus an optional query string, e.g.
 * "/leave/requests/lr-1/cancel" or "/attendance?from=2026-09-01&to=2026-09-30".
 */
export function handleMockRequest(method: string, path: string, rawBody?: string): MockResult {
  const url = new URL(`http://mock${path}`);
  const segments = url.pathname.split('/').filter(Boolean);
  const query = url.searchParams;
  let body: any = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }

  const [root, ...rest] = segments;

  if (root === 'attendance') {
    if (rest.length === 0) return handleAttendanceRoot(query);
    return handleAttendance(method, rest, query, body);
  }
  if (root === 'leave') {
    return handleLeave(method, rest, query, body);
  }
  if (root === 'calendar') {
    return handleCalendar(method, rest, query, body);
  }

  // Every other module (employees, departments, payroll, performance,
  // community, notifications, ...) isn't mocked yet - return an empty but
  // successful response so pages render instead of erroring.
  if (method === 'GET') return ok([]);
  return ok({});
}
