/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { setupTabSwitching } from './tabs'

describe('setupTabSwitching', () => {
    function createTabs(): { container: HTMLElement; buttons: HTMLElement[]; contents: HTMLElement[] } {
        const container = document.createElement('div')

        const btn1 = document.createElement('button')
        btn1.className = 've-tab-button active'
        btn1.setAttribute('data-tab', 've')
        btn1.textContent = 'VE'

        const btn2 = document.createElement('button')
        btn2.className = 've-tab-button'
        btn2.setAttribute('data-tab', 'power')
        btn2.textContent = 'Power'

        const btn3 = document.createElement('button')
        btn3.className = 've-tab-button'
        btn3.setAttribute('data-tab', 'wind')
        btn3.textContent = 'Wind'

        const content1 = document.createElement('div')
        content1.id = 've-tab'
        content1.className = 've-tab-content active'

        const content2 = document.createElement('div')
        content2.id = 'power-tab'
        content2.className = 've-tab-content'

        const content3 = document.createElement('div')
        content3.id = 'wind-tab'
        content3.className = 've-tab-content'

        container.append(btn1, btn2, btn3, content1, content2, content3)
        document.body.appendChild(container)

        return {
            container,
            buttons: [btn1, btn2, btn3],
            contents: [content1, content2, content3],
        }
    }

    it('toggles active classes when clicking a tab button', () => {
        const { container, buttons, contents } = createTabs()

        setupTabSwitching()

        // Click the power tab
        buttons[1].click()

        // Check buttons
        expect(buttons[0].classList.contains('active')).toBe(false)
        expect(buttons[1].classList.contains('active')).toBe(true)
        expect(buttons[2].classList.contains('active')).toBe(false)

        // Check contents
        expect(contents[0].classList.contains('active')).toBe(false)
        expect(contents[1].classList.contains('active')).toBe(true)
        expect(contents[2].classList.contains('active')).toBe(false)

        document.body.removeChild(container)
    })

    it('invokes the renderMap callback for the clicked tab', () => {
        const { container, buttons } = createTabs()
        const windRenderer = vi.fn()
        const powerRenderer = vi.fn()

        setupTabSwitching({ wind: windRenderer, power: powerRenderer })

        // Click wind tab
        buttons[2].click()
        expect(windRenderer).toHaveBeenCalledTimes(1)
        expect(powerRenderer).not.toHaveBeenCalled()

        // Click power tab
        buttons[1].click()
        expect(powerRenderer).toHaveBeenCalledTimes(1)

        document.body.removeChild(container)
    })

    it('does not invoke wind callback when wind-tab element does not exist', () => {
        const { container, buttons, contents } = createTabs()
        // Remove wind-tab so showWindTab check fails
        contents[2].remove()

        const windRenderer = vi.fn()
        setupTabSwitching({ wind: windRenderer })

        buttons[2].click()
        expect(windRenderer).not.toHaveBeenCalled()

        document.body.removeChild(container)
    })

    it('handles missing data-tab attribute gracefully', () => {
        const { container, buttons } = createTabs()
        // Remove data-tab from first button
        buttons[0].removeAttribute('data-tab')

        // Should not throw
        setupTabSwitching()
        expect(() => buttons[0].click()).not.toThrow()

        document.body.removeChild(container)
    })
})
