const api = typeof browser !== 'undefined' ? browser : chrome;
document.getElementById('version').textContent = `v${api.runtime.getManifest().version}`;
