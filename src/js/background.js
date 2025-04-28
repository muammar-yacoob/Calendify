var API_URL = 'http://localhost:3000/api/summarise';
// var API_URL = 'https://Calendify.vercel.app';

console.log('Background script loaded');

// Setup context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToCalendar",
    title: "Add to Calendar",
    contexts: ["selection", "page"],
    documentUrlPatterns: ["*://*/*"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "addToCalendar") {
    // Try to get event details from the content script
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
      // If content script not loaded, open popup with just selected text
      if (chrome.runtime.lastError) {
        openPopupWithDetails(info.selectionText || '');
      }
    });
  }
});

// Open popup with provided details
function openPopupWithDetails(selectedText, eventDetails = null) {
  let url = `src/html/popup.html?text=${encodeURIComponent(selectedText)}`;
  
  // Add event details to URL if available
  if (eventDetails) {
    if (eventDetails.title) url += `&title=${encodeURIComponent(eventDetails.title)}`;
    if (eventDetails.date) url += `&date=${encodeURIComponent(eventDetails.date)}`;
    if (eventDetails.time) url += `&time=${encodeURIComponent(eventDetails.time)}`;
    if (eventDetails.location) url += `&location=${encodeURIComponent(eventDetails.location)}`;
  }
  
  // Open popup window
  chrome.windows.create({
    url: url,
    type: 'popup',
    width: 370,
    height: 420
  });
}

// Message handlers
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "processSelectedText") {
    // Handle event details from content script
    openPopupWithDetails(message.selectedText, message.eventDetails);
  }
  else if (message.action === "addToCalendar") {
    // Handle adding event to calendar
    addToGoogleCalendar(message.eventDetails)
      .then(success => sendResponse({ success }))
      .catch(error => {
        console.error('Error adding to calendar:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
});

// Add event to Google Calendar
async function addToGoogleCalendar(eventDetails) {
  try {
    // Format start date/time
    let startDateTime = eventDetails.date;
    if (eventDetails.time) {
      startDateTime += `T${eventDetails.time}:00`;
    } else {
      startDateTime += 'T00:00:00'; // All-day event
    }

    // Calculate end time (1 hour later or next day for all-day events)
    let endDateTime;
    if (eventDetails.time) {
      const [hours, minutes] = eventDetails.time.split(':');
      const endTime = new Date();
      endTime.setHours(parseInt(hours));
      endTime.setMinutes(parseInt(minutes) + 60);
      endDateTime = eventDetails.date + 
        `T${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}:00`;
    } else {
      // For all-day events, end date is the next day
      const nextDay = new Date(eventDetails.date);
      nextDay.setDate(nextDay.getDate() + 1);
      endDateTime = nextDay.toISOString().split('T')[0] + 'T00:00:00';
    }

    // Create event object
    const event = {
      summary: eventDetails.title,
      location: eventDetails.location || '',
      description: eventDetails.description || '',
      start: {
        dateTime: startDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: endDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    };

    // Store event locally (placeholder for actual Google Calendar API integration)
    const { calendarEvents = [] } = await chrome.storage.sync.get('calendarEvents');
    calendarEvents.push({
      ...event,
      createdAt: new Date().toISOString()
    });
    
    await chrome.storage.sync.set({ calendarEvents });
    
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/res/icons/icon128.png',
      title: 'Event Added',
      message: `"${eventDetails.title}" has been added to your calendar.`
    });
    
    return true;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

async function fetchSummary(videoUrl, tab) {
  console.log('Fetching summary for:', videoUrl);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl })
    });

    const data = await response.json();
    console.log('API response:', data);
    saveSummary(data.summary, tab);
  } catch (error) {
    console.error('Fetch error:', error);
    saveSummary(`Error: ${error.message}`, tab);
  }
}

function saveSummary(summary, tab) {
  console.log('Saving summary');
  chrome.storage.sync.set({ 
    lastSummary: {
      text: summary,
      url: tab.url,
      title: tab.title
    }
  });
  console.log('Summary saved');
}