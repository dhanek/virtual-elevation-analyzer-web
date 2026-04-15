/**
 * Lap selection event binding using shell/dom/selectableCards.
 *
 * Extracted from initializeSection3 in main.ts to make lap binding
 * reusable and testable independently from template rendering.
 *
 * Per D-08: preserves exact checkbox, card click, and select-all behavior.
 */
import { bindSelectableCardEvents } from '../dom/selectableCards';
import { log } from '../../utils/log';

/**
 * Bind lap checkbox change and card click events on the FIT lap list.
 * Replaces the inline change/click listeners previously in setupLapSelectionHandlers.
 *
 * @param container - The lapList element containing rendered lap cards
 * @param onSelectionChange - Callback invoked with array of selected lap numbers
 */
export function bindLapSelection(
    container: HTMLElement,
    onSelectionChange: (selectedLaps: number[]) => void,
): void {
    bindSelectableCardEvents(container, 'lap-checkbox', 'lap', (selectedValues) => {
        log.debug('FIT lap selection changed:', selectedValues);
        onSelectionChange(selectedValues);
    });
}

/**
 * Bind the select/deselect all button to toggle all FIT lap checkboxes.
 * Replaces the toggleAllLaps function previously inline in main.ts.
 *
 * @param buttonId - ID of the select/deselect all button (e.g. 'selectAllLaps')
 * @param lapListId - ID of the lap list container (e.g. 'lapList')
 * @param onToggle - Callback invoked after toggling (receives no args; reads DOM state)
 */
export function bindSelectAllButton(
    buttonId: string,
    lapListId: string,
    onToggle: () => void,
): void {
    const button = document.getElementById(buttonId);
    if (!button) {
        log.warn(`Select-all button #${buttonId} not found`);
        return;
    }

    button.addEventListener('click', () => {
        const container = document.getElementById(lapListId);
        if (!container) return;

        const checkboxes = container.querySelectorAll('.lap-checkbox') as NodeListOf<HTMLInputElement>;
        const anySelected = Array.from(checkboxes).some(cb => cb.checked);

        // Toggle: if any selected, deselect all; otherwise select all
        checkboxes.forEach(cb => {
            cb.checked = !anySelected;
            const item = cb.closest('.lap-checkbox-item');
            if (item) {
                if (cb.checked) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            }
        });

        log.debug('Select-all toggled, anySelected was:', anySelected);
        onToggle();
    });
}
