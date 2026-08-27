/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    bindTabButtons,
    resetTabRenderMapForNewPanel,
    setTabRenderMap,
    setupTabSwitching,
} from './tabs'

describe('setupTabSwitching', () => {
    // WR-09. `currentRenderMap` is MODULE state and nothing reset it, so each
    // case inherited the previous case's map. The worst of it was silent: the
    // 'bound before any render map is set' case ran with `{ power }` still
    // installed and clicked the power button, invoking the previous case's spy
    // while asserting only on class toggling — it passed while testing the
    // opposite of its title.
    beforeEach(() => {
        document.body.replaceChildren()
        setTabRenderMap({})
    })

    function createTabs(): { container: HTMLElement; buttons: HTMLElement[]; contents: HTMLElement[] } {
        const container = document.createElement('div')

        const btn1 = document.createElement('button')
        btn1.className = 've-tab-button ve-tab-button--active'
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
        content1.className = 've-tab-content ve-tab-content--active'

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
        expect(buttons[0].classList.contains('ve-tab-button--active')).toBe(false)
        expect(buttons[1].classList.contains('ve-tab-button--active')).toBe(true)
        expect(buttons[2].classList.contains('ve-tab-button--active')).toBe(false)

        // Check contents
        expect(contents[0].classList.contains('ve-tab-content--active')).toBe(false)
        expect(contents[1].classList.contains('ve-tab-content--active')).toBe(true)
        expect(contents[2].classList.contains('ve-tab-content--active')).toBe(false)

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

    it('does not accumulate handlers across repeated setup calls (uses latest renderMap)', () => {
        const { container, buttons } = createTabs()
        const firstPower = vi.fn()
        const secondPower = vi.fn()

        // Simulates re-running setupTabSwitching on every recompute.
        setupTabSwitching({ power: firstPower })
        setupTabSwitching({ power: secondPower })

        buttons[1].click()

        // Only the latest renderMap should fire, exactly once — no stale handler
        // from the first setup call.
        expect(firstPower).not.toHaveBeenCalled()
        expect(secondPower).toHaveBeenCalledTimes(1)

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

    /**
     * WR-13. `renderStandardVe` used to call `setupTabSwitching()` bare, which
     * did two unrelated things at once: it bound the click handlers AND
     * assigned `currentRenderMap = {}`, wiping the real map that
     * `createStandardUpdateCallbacks.renderVe` installs.
     *
     * It only ever appeared to work because `scheduleRecompute` defers to a
     * macrotask, so the real map landed after the wipe. On any path where the
     * scheduled pass never reaches `renderVe` — every segment under
     * MIN_SEGMENT_SAMPLES, every calculator throwing, a trim window at its
     * clamp — Wind/Power/VD stayed dead for the panel's lifetime.
     *
     * Removing the bare call fixed the wipe but took the binding with it. These
     * cover the split that keeps both: binding is unconditional, the map is set
     * separately, and neither clobbers the other.
     */
    describe('bindTabButtons / setTabRenderMap', () => {
        it('binds click handlers without touching the render map', () => {
            const { container, buttons } = createTabs()
            const power = vi.fn()

            setTabRenderMap({ power })
            // The call that used to wipe the map. It must now only bind.
            bindTabButtons()

            buttons[1].click()

            expect(power).toHaveBeenCalledTimes(1)

            document.body.removeChild(container)
        })

        it('switches tabs when bound before any render map is set', () => {
            const { container, buttons, contents } = createTabs()
            const shouldNotRender = vi.fn()
            setTabRenderMap({ power: shouldNotRender })
            setTabRenderMap({})

            bindTabButtons()

            buttons[1].click()

            expect(buttons[1].classList.contains('ve-tab-button--active')).toBe(true)
            expect(contents[1].classList.contains('ve-tab-content--active')).toBe(true)
            // The title's actual claim: no map is installed, so nothing renders.
            expect(shouldNotRender).not.toHaveBeenCalled()

            document.body.removeChild(container)
        })

        /**
         * WR-01. The WR-13 split traded one failure for a worse one.
         *
         * `bindTabButtons()` deliberately does not touch `currentRenderMap`, so
         * on every path where the newly scheduled pass does not reach
         * `renderVe`, the PREVIOUS panel's map survives verbatim. Its callbacks
         * close over that panel's `profiles` array, and the Standard panel
         * reuses the same element ids on every render — so Wind/Power/VD draw
         * the previous lap selection's data into the new panel, unlabelled.
         *
         * The bare `setupTabSwitching()` this replaced failed SAFE here: an
         * empty map renders nothing. This one fails unsafe, which is worse.
         * The map must die with the nodes its callbacks draw into.
         */
        it('drops the previous panel map when the panel is rebuilt', () => {
            const first = createTabs()
            const previousPanelRenderer = vi.fn()
            setTabRenderMap({ power: previousPanelRenderer })
            bindTabButtons()
            document.body.removeChild(first.container)

            // A new panel replaces the old markup, as `veAnalysisContent.innerHTML = ...`
            // does, and binds its buttons before its first recompute lands.
            const second = createTabs()
            resetTabRenderMapForNewPanel()
            bindTabButtons()

            second.buttons[1].click()

            expect(previousPanelRenderer).not.toHaveBeenCalled()

            document.body.removeChild(second.container)
        })

        it('keeps the map installed when binding is repeated', () => {
            const { container, buttons } = createTabs()
            const power = vi.fn()

            bindTabButtons()
            setTabRenderMap({ power })
            bindTabButtons()

            buttons[1].click()

            expect(power).toHaveBeenCalledTimes(1)

            document.body.removeChild(container)
        })
    })
})
