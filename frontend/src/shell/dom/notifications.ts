/**
 * Show notification to user.
 * Extracted from main.ts.
 *
 * @param message - Message to display
 * @param type - Notification type ('success', 'warning', 'error')
 */
export function showNotification(message: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');

    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.className = 'notification hidden';
        document.body.appendChild(notification);
    }

    // Type is a discrete state — swap the D-07 modifier class instead of
    // mutating style.backgroundColor/style.color.
    notification.classList.remove(
        'notification--success',
        'notification--warning',
        'notification--error',
    );
    notification.classList.add(`notification--${type}`);
    notification.textContent = message;
    notification.classList.remove('hidden');

    // Auto-hide after 5 seconds
    setTimeout(() => {
        notification?.classList.add('hidden');
    }, 5000);
}
