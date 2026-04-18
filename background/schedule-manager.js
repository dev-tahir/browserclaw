// Schedule Manager — Persists and evaluates scheduled skill runs.
// Schedules are stored in chrome.storage.local under 'schedules'.

export class ScheduleManager {
  constructor() {
    this.schedules = new Map();
  }

  async load() {
    const data = await chrome.storage.local.get('schedules');
    const arr = data.schedules || [];
    this.schedules.clear();
    for (const s of arr) this.schedules.set(s.id, s);
  }

  async _persist() {
    await chrome.storage.local.set({ schedules: [...this.schedules.values()] });
  }

  getAll() {
    return [...this.schedules.values()];
  }

  get(id) {
    return this.schedules.get(id) || null;
  }

  async save(schedule) {
    if (!schedule.id) {
      schedule.id = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    schedule.updatedAt = Date.now();
    if (!schedule.createdAt) schedule.createdAt = Date.now();

    // Compute nextRun
    schedule.nextRun = this.computeNextRun(schedule);

    this.schedules.set(schedule.id, schedule);
    await this._persist();
    return schedule;
  }

  async delete(id) {
    this.schedules.delete(id);
    await this._persist();
    // Clear associated alarm
    try { await chrome.alarms.clear(`sched_${id}`); } catch {}
  }

  async markRan(id) {
    const s = this.schedules.get(id);
    if (!s) return;
    s.lastRun = Date.now();
    s.missedRun = false;

    if (s.repeat === 'once') {
      s.enabled = false;
      s.nextRun = null;
    } else {
      s.nextRun = this.computeNextRun(s);
    }

    await this._persist();
  }

  // ── Compute next run timestamp ──────────────────────────────────────────

  computeNextRun(s) {
    if (!s.enabled) return null;

    const now = Date.now();

    switch (s.repeat) {
      case 'once': {
        const t = this._timeToday(s.time);
        return t > now ? t : t + 86400000; // today or tomorrow
      }

      case 'hourly': {
        const d = new Date();
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() + 1);
        return d.getTime();
      }

      case 'daily': {
        const t = this._timeToday(s.time);
        return t > now ? t : t + 86400000;
      }

      case 'weekdays': {
        return this._nextWeekday(s.time);
      }

      case 'weekly': {
        return this._nextWeeklyDay(s.time, parseInt(s.day || 1));
      }

      case 'custom': {
        const ms = this._customToMs(s.customValue, s.customUnit);
        const base = s.lastRun || now;
        let next = base + ms;
        if (next <= now) next = now + ms;
        return next;
      }

      default:
        return null;
    }
  }

  _timeToday(timeStr) {
    const [h, m] = (timeStr || '09:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  _nextWeekday(time) {
    const [h, m] = (time || '09:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);

    // Find next weekday
    for (let i = 0; i < 8; i++) {
      const candidate = new Date(d.getTime() + i * 86400000);
      const dow = candidate.getDay();
      if (dow >= 1 && dow <= 5 && candidate.getTime() > Date.now()) {
        return candidate.getTime();
      }
    }
    return d.getTime() + 86400000;
  }

  _nextWeeklyDay(time, targetDay) {
    const [h, m] = (time || '09:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);

    const currentDay = d.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && d.getTime() <= Date.now()) daysUntil = 7;

    return d.getTime() + daysUntil * 86400000;
  }

  _customToMs(value, unit) {
    const v = parseInt(value) || 1;
    switch (unit) {
      case 'minutes': return v * 60000;
      case 'hours':   return v * 3600000;
      case 'days':    return v * 86400000;
      default:        return v * 3600000;
    }
  }

  // ── Get all due schedules ──────────────────────────────────────────────

  getDueSchedules() {
    const now = Date.now();
    const due = [];
    for (const s of this.schedules.values()) {
      if (!s.enabled) continue;
      if (s.nextRun && s.nextRun <= now) {
        due.push(s);
      }
    }
    return due;
  }

  // Check for missed runs (computer was off)
  getMissedSchedules() {
    const now = Date.now();
    const missed = [];
    for (const s of this.schedules.values()) {
      if (!s.enabled || !s.catchUp) continue;
      if (s.nextRun && s.nextRun < now) {
        missed.push(s);
      }
    }
    return missed;
  }
}
