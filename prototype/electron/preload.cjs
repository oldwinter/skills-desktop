const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skillsDesktop", {
  listLocalSkills: () => ipcRenderer.invoke("skills:list-local"),
});
