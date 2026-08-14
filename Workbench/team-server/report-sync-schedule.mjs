const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: SHANGHAI_TIME_ZONE });

export function shanghaiDate(value = new Date(), offsetDays = 0) {
  const date = value instanceof Date ? value : new Date(value);
  return dateFormatter.format(new Date(date.getTime() + offsetDays * DAY_MS));
}

export function dailyReportSyncRange(value = new Date()) {
  return { from: shanghaiDate(value, -1), to: shanghaiDate(value) };
}

export function nextDailyReportSyncAt(value = new Date(), hour = 8) {
  const current = value instanceof Date ? value : new Date(value);
  const today = shanghaiDate(current);
  const syncHour = Number.isInteger(Number(hour)) && Number(hour) >= 0 && Number(hour) <= 23 ? Number(hour) : 8;
  let target = new Date(`${today}T${String(syncHour).padStart(2, "0")}:00:00+08:00`);
  if (target.getTime() <= current.getTime()) {
    target = new Date(`${shanghaiDate(current, 1)}T${String(syncHour).padStart(2, "0")}:00:00+08:00`);
  }
  return target;
}

export function startDailyReportSyncScheduler({ run, hour = 8, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, logger = console } = {}) {
  let timer = null;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const current = now();
    const target = nextDailyReportSyncAt(current, hour);
    timer = setTimer(async () => {
      try {
        const range = dailyReportSyncRange(now());
        const result = await run(range);
        logger.info?.(`DingTalk daily report sync completed: ${range.from}..${range.to}, pulled=${result?.pulled || 0}, upserted=${result?.upserted || 0}`);
      } catch (failure) {
        logger.warn?.(`DingTalk daily report sync failed: ${failure.message}`);
      } finally {
        schedule();
      }
    }, Math.max(0, target.getTime() - current.getTime()));
    timer?.unref?.();
  };
  schedule();
  return () => {
    stopped = true;
    if (timer !== null) clearTimer(timer);
  };
}
