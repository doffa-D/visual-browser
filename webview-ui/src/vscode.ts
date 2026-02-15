declare global {
    interface Window {
        acquireVsCodeApi: () => any;
    }
}

let vscodeApi: any;

export function getVsCodeApi() {
    if (!vscodeApi) {
        if (typeof window.acquireVsCodeApi === 'function') {
            vscodeApi = window.acquireVsCodeApi();
        } else {
            console.warn('acquireVsCodeApi is not available');
            vscodeApi = {
                postMessage: (msg: any) => console.log('Mock PostMessage:', msg),
                getState: () => ({}),
                setState: () => {}
            };
        }
    }
    return vscodeApi;
}






