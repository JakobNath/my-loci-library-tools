// What the app says about backups (PLAN.md, "Backups"; Settings, "Data and
// care"), from backup-status.json, which the laptop tool loci-backup keeps in
// the data repository (DATA_FORMAT.md, "backup-status.json").

const YEAR_DAYS = 365;
const daysBetween = (from, to) => (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000;

/** One line on the last daily backup, or null when there has never been one. */
export function lastBackupLine(status) {
  if (!status || !status.lastMirror) return null;
  return `Last backup to the backup folder: ${status.lastMirror.slice(0, 10)}.`;
}

/**
 * The yearly reminder to save a full archive to an external drive: due a year
 * after the last archive, or a year after the first backup if none was made yet.
 * @param {object|null} status backup-status.json
 * @param {string} today "YYYY-MM-DD"
 * @returns {string|null} the reminder, or null when none is due
 */
export function archiveReminder(status, today) {
  if (!status) return null;
  const since = status.lastArchive || status.firstBackup;
  if (!since || daysBetween(since, today) < YEAR_DAYS) return null;
  return 'A year has passed since the last full archive. On the laptop, plug in an external drive and run loci-backup with --archive (the tools README explains).';
}
