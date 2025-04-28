// Calendify Content Script - Simplified
console.log('Calendify content script loaded');

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ success: true });
  } else if (message.action === "getSelection") {
    const eventDetails = extractEventData();
    console.log('Extracted data:', eventDetails);
    sendResponse({ success: true, eventDetails });
  }
  return true;
});

// Extract event data using built-in DOM methods
function extractEventData() {
  // Basic event details object
  const data = {
    title: "",
    date: "",
    time: "",
    location: "",
    text: window.getSelection().toString().trim()
  };
  
  // 1. Selected text has priority
  if (data.text) {
    console.log('Selected text:', data.text);
    parseSelectedText(data);
  }
  
  // 2. Find missing data in the DOM
  if (!data.title) data.title = findPageTitle();
  if (!data.date) data.date = findDate();
  if (!data.time) data.time = findTime();
  if (!data.location) data.location = findLocation();
  
  return data;
}

// Parse selected text for event details
function parseSelectedText(data) {
  const text = data.text;
  
  // Find dates like "Sun, 2 Nov, 10:00"
  const dateRegex = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s*(\d{1,2}):(\d{2})\b/i;
  const dateMatch = text.match(dateRegex);
  
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = getMonthNumber(dateMatch[2]);
    const hour = dateMatch[3].padStart(2, '0');
    const minute = dateMatch[4];
    
    data.date = `${new Date().getFullYear()}-${month}-${day}`;
    data.time = `${hour}:${minute}`;
    console.log('Found date & time in selection:', data.date, data.time);
  }
  
  // Find location
  const locationMatch = text.match(/(?:location|venue|place|at)[\s:]+([^\n,\.]+)/i);
  if (locationMatch) {
    data.location = locationMatch[1].trim();
    console.log('Found location in selection:', data.location);
  }
}

// Find the most likely page title
function findPageTitle() {
  // Try multiple strategies to find a title
  const strategies = [
    // Try structured data
    () => document.querySelector('[itemprop="name"]')?.textContent.trim(),
    // Try common heading elements
    () => document.querySelector('h1')?.textContent.trim(),
    // Try event-specific classes
    () => document.querySelector('.event-title, .title, .event-name')?.textContent.trim(),
    // Fallback to page title
    () => document.title
  ];
  
  for (const strategy of strategies) {
    const result = strategy();
    if (result) {
      console.log('Found title:', result);
      return result;
    }
  }
  
  return document.title;
}

// Find the most likely date
function findDate() {
  // Priority 1: Structured data with datetime attributes
  const datetimeEl = document.querySelector('[itemprop="startDate"], [datetime], time[datetime]');
  if (datetimeEl) {
    const datetimeStr = datetimeEl.getAttribute('datetime') || datetimeEl.getAttribute('content');
    if (datetimeStr) {
      try {
        const dateObj = new Date(datetimeStr);
        if (!isNaN(dateObj.getTime())) {
          const date = dateObj.toISOString().split('T')[0];
          console.log('Found date in structured data:', date);
          return date;
        }
      } catch (e) {}
    }
  }
  
  // Priority 2: Common date element classes
  const dateEl = document.querySelector('.date, .event-date, .datetime');
  if (dateEl && dateEl.textContent.trim()) {
    const text = dateEl.textContent.trim();
    
    // Try to parse formats like DD/MM/YYYY or DD-MM-YYYY
    const dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}|\d{2})/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      console.log('Found date in element:', `${year}-${month}-${day}`);
      return `${year}-${month}-${day}`;
    }
  }
  
  // Priority 3: Look for date patterns in visible text
  const paragraphs = Array.from(document.querySelectorAll('p, span, div')).filter(el => {
    // Only consider visible elements with substantial text
    return el.offsetParent !== null && el.textContent.trim().length > 10;
  }).map(el => el.textContent.trim());
  
  // Look for "Sun, 2 Nov" pattern in paragraphs
  for (const text of paragraphs) {
    const dateMatch = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = getMonthNumber(dateMatch[2]);
      const year = new Date().getFullYear();
      console.log('Found date pattern in text:', `${year}-${month}-${day}`);
      return `${year}-${month}-${day}`;
    }
  }
  
  return "";
}

// Find the most likely time
function findTime() {
  // Priority 1: Time element with specific class
  const timeEl = document.querySelector('.time, .event-time');
  if (timeEl && timeEl.textContent.trim()) {
    const text = timeEl.textContent.trim();
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      console.log('Found time in element:', time);
      return time;
    }
  }
  
  // Priority 2: Look for time patterns in visible text
  const paragraphs = Array.from(document.querySelectorAll('p, span, div')).filter(el => {
    return el.offsetParent !== null && el.textContent.trim().length > 5;
  }).map(el => el.textContent.trim());
  
  for (const text of paragraphs) {
    // Look for HH:MM pattern
    const timeMatch = text.match(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2];
      const ampm = timeMatch[3]?.toLowerCase();
      
      // Convert to 24-hour format if am/pm is specified
      if (ampm === 'pm' && hour < 12) hour += 12;
      else if (ampm === 'am' && hour === 12) hour = 0;
      
      const time = `${hour.toString().padStart(2, '0')}:${minute}`;
      console.log('Found time pattern in text:', time);
      return time;
    }
  }
  
  return "";
}

// Find the most likely location
function findLocation() {
  // Priority 1: Structured data for location
  const locationEl = document.querySelector('[itemprop="location"], .location, .venue, .place, .event-location, [itemprop="address"]');
  if (locationEl && locationEl.textContent.trim()) {
    const location = locationEl.textContent.trim();
    console.log('Found location in element:', location);
    return location;
  }
  
  // Priority 2: Look for location patterns in text
  const paragraphs = Array.from(document.querySelectorAll('p, span, div')).filter(el => {
    return el.offsetParent !== null;
  }).map(el => el.textContent.trim());
  
  for (const text of paragraphs) {
    // Look for "Location: X" or "Venue: X" pattern
    const locationMatch = text.match(/(?:location|venue|place|at|where)[\s:]+([^\n,\.]+)/i);
    if (locationMatch) {
      console.log('Found location pattern in text:', locationMatch[1].trim());
      return locationMatch[1].trim();
    }
  }
  
  return "";
}

// Helper function to convert month name to number (padded to 2 digits)
function getMonthNumber(monthName) {
  const months = { 
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' 
  };
  const key = monthName.substring(0, 3).toLowerCase();
  return months[key] || '01';
}

// Extract data when page loads
setTimeout(() => {
  const eventDetails = extractEventData();
  console.log('Initial page data extraction:', eventDetails);
  chrome.storage.local.set({ lastExtractedDetails: eventDetails });
}, 1000);