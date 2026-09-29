const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the page and the machine.
//
// Deliberately tiny and deliberately one-way: each call opens a NATIVE dialog
// that the user answers, so the page can never name a file by itself. There is
// no general "read this path" here, and there should not be.
contextBridge.exposeInMainWorld('studio', {
  desktop: true,
  pickVideo: () => ipcRenderer.invoke('studio:pick-video'),
  pickFolder: () => ipcRenderer.invoke('studio:pick-folder'),
  reveal: (path) => ipcRenderer.invoke('studio:reveal', path),
  info: () => ipcRenderer.invoke('studio:info'),
});
