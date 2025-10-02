export interface ViewportInfo {
    width: number;
    height: number;
    ratio: number;
    category: 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'ultrawide';
    isLandscape: boolean;
}

export class ViewportAdapter {
    private static instance: ViewportAdapter;
    private viewportInfo: ViewportInfo;
    private callbacks: ((info: ViewportInfo) => void)[] = [];

    private constructor() {
        this.viewportInfo = this.calculateViewportInfo();
        this.setupResizeListener();
        this.applyCSSCustomProperties();
    }

    public static getInstance(): ViewportAdapter {
        if (!ViewportAdapter.instance) {
            ViewportAdapter.instance = new ViewportAdapter();
        }
        return ViewportAdapter.instance;
    }

    private calculateViewportInfo(): ViewportInfo {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const ratio = width / height;
        const isLandscape = width > height;

        let category: ViewportInfo['category'];
        if (width < 768) {
            category = 'mobile';
        } else if (width < 1024) {
            category = 'tablet';
        } else if (width < 1440) {
            category = 'laptop';
        } else if (width < 2560) {
            category = 'desktop';
        } else {
            category = 'ultrawide';
        }

        return {
            width,
            height,
            ratio,
            category,
            isLandscape
        };
    }

    private applyCSSCustomProperties(): void {
        const root = document.documentElement;
        const { width, height, ratio, category } = this.viewportInfo;

        // Set viewport dimensions as CSS custom properties
        root.style.setProperty('--vw', `${width}px`);
        root.style.setProperty('--vh', `${height}px`);
        root.style.setProperty('--aspect-ratio', ratio.toString());

        // Set category-specific variables
        root.style.setProperty('--viewport-category', category);

        // Calculate adaptive values
        const mapHeight = this.calculateOptimalMapHeight();
        const contentWidth = this.calculateOptimalContentWidth();
        const gridColumns = this.calculateOptimalGridColumns();

        root.style.setProperty('--map-height', `${mapHeight}px`);
        root.style.setProperty('--content-max-width', `${contentWidth}px`);
        root.style.setProperty('--grid-columns', gridColumns.toString());

        // Apply viewport-specific classes
        document.body.className = document.body.className.replace(/viewport-\w+/g, '');
        document.body.classList.add(`viewport-${category}`);

        console.log('Viewport adapted:', {
            width,
            height,
            category,
            mapHeight,
            contentWidth,
            gridColumns,
            sidebarWidth: this.getOptimalSidebarWidth()
        });
    }

    private calculateOptimalMapHeight(): number {
        const { width, height, category } = this.viewportInfo;

        switch (category) {
            case 'mobile':
                return Math.min(500, height * 0.6);
            case 'tablet':
                return Math.min(600, height * 0.7);
            case 'laptop':
                return Math.min(800, height * 0.75);
            case 'desktop':
                return Math.min(900, height * 0.8);
            case 'ultrawide':
                return Math.min(1000, height * 0.85);
            default:
                return 600;
        }
    }

    private calculateOptimalContentWidth(): number {
        const { width, category } = this.viewportInfo;

        switch (category) {
            case 'mobile':
                return width - 16; // 8px padding on each side
            case 'tablet':
                return width - 32; // 16px padding on each side
            case 'laptop':
                return width - 40; // 20px padding on each side
            case 'desktop':
                return width - 60; // 30px padding on each side
            case 'ultrawide':
                return width - 80; // 40px padding on each side
            default:
                return width - 32;
        }
    }

    private calculateOptimalGridColumns(): number {
        const { width, category } = this.viewportInfo;

        if (category === 'mobile') return 1;
        if (category === 'tablet') return width > 900 ? 2 : 1;
        if (category === 'laptop') return 2;
        if (category === 'desktop') return width > 1600 ? 3 : 2;
        if (category === 'ultrawide') return width > 2200 ? 4 : 3;

        return 2;
    }

    private setupResizeListener(): void {
        let resizeTimeout: number;

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = window.setTimeout(() => {
                this.viewportInfo = this.calculateViewportInfo();
                this.applyCSSCustomProperties();
                this.notifyCallbacks();
            }, 150);
        });
    }

    public onViewportChange(callback: (info: ViewportInfo) => void): void {
        this.callbacks.push(callback);
    }

    public removeViewportCallback(callback: (info: ViewportInfo) => void): void {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }

    private notifyCallbacks(): void {
        this.callbacks.forEach(callback => callback(this.viewportInfo));
    }

    public getViewportInfo(): ViewportInfo {
        return { ...this.viewportInfo };
    }

    public isLargeScreen(): boolean {
        return this.viewportInfo.category === 'desktop' || this.viewportInfo.category === 'ultrawide';
    }

    public shouldUseFullWidth(): boolean {
        return this.viewportInfo.width > 1200;
    }

    public getOptimalSidebarWidth(): number {
        const { width, category } = this.viewportInfo;

        switch (category) {
            case 'laptop':
                return Math.min(320, width * 0.20);
            case 'desktop':
                return Math.min(350, width * 0.18);
            case 'ultrawide':
                return Math.min(380, width * 0.15);
            default:
                return 300;
        }
    }
}