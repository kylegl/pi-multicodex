export function formatResetAt(resetAt?: number): string {
	if (!resetAt) return "unknown";
	const diffMs = resetAt - Date.now();
	if (diffMs <= 0) return "now";
	const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
	if (diffMinutes < 60) return `in ${diffMinutes}m`;
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 48) return `in ${diffHours}h`;
	const diffDays = Math.round(diffHours / 24);
	return `in ${diffDays}d`;
}
