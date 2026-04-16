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
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000;
            max-width: 400px;
            font-size: 0.9em;
            display: none;
        `;
        document.body.appendChild(notification);
    }

    // Set colors based on type
    const colors = {
        success: { bg: '#4CAF50', text: '#fff' },
        warning: { bg: '#FF9800', text: '#fff' },
        error: { bg: '#f44336', text: '#fff' }
    };

    notification.style.backgroundColor = colors[type].bg;
    notification.style.color = colors[type].text;
    notification.textContent = message;
    notification.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => {
        if (notification) {
            notification.style.display = 'none';
        }
    }, 5000);
}
