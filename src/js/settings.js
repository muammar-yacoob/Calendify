// settings.js
document.addEventListener('DOMContentLoaded', async () => {
  initializeSettings();
  setupEventListeners();
});

function initializeSettings() {
  // Set extension name and version from manifest
  const manifest = chrome.runtime.getManifest();
  document.getElementById('extensionName').textContent = manifest.name;
  document.getElementById('extensionVersion').textContent = `v${manifest.version}`;
  
  // Initialize language options
  const languages = {
    en: "English",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    ar: "العربية",
    zh: "中文"
  };
  
  const languageSelect = document.getElementById('language');
  Object.entries(languages).forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${name} (${code.toUpperCase()})`;
    languageSelect.appendChild(option);
  });

  loadSavedSettings();
}

async function loadSavedSettings() {
  const settings = await chrome.storage.sync.get({
    language: 'en',
    level: 'brief'
  });

  document.getElementById('language').value = settings.language;
  document.getElementById('level').value = settings.level;
  
  // Initialize save button state
  updateSaveButton(false);
}

function setupEventListeners() {
  const languageSelect = document.getElementById('language');
  const levelSelect = document.getElementById('level');
  const saveBtn = document.getElementById('save');

  // Track changes
  let hasChanges = false;
  
  function handleChange() {
    hasChanges = true;
    updateSaveButton(true);
  }

  languageSelect.addEventListener('change', handleChange);
  levelSelect.addEventListener('change', handleChange);

  // Save settings
  saveBtn.addEventListener('click', async () => {
    if (!hasChanges) return;

    const newSettings = {
      language: languageSelect.value,
      level: levelSelect.value
    };

    await chrome.storage.sync.set(newSettings);
    showSaveConfirmation();
  });
}

function updateSaveButton(enabled) {
  const saveBtn = document.getElementById('save');
  saveBtn.disabled = !enabled;
}

function showSaveConfirmation() {
  const saveBtn = document.getElementById('save');
  const originalText = saveBtn.textContent;
  
  saveBtn.textContent = 'Saved!';
  saveBtn.disabled = true;
  
  setTimeout(() => {
    saveBtn.textContent = originalText;
    window.close();
  }, 750);
}