var API_URL = 'http://localhost:3000/api/summarise';
// var API_URL = 'https://Calendify.vercel.app';

console.log('Background script loaded');

// Setup context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-calendar",
    title: "Add to Calendar",
    contexts: ["selection", "page"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-to-calendar") {
    // Try to send message to content script to get selected text
    try {
      chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, response => {
        if (chrome.runtime.lastError) {
          console.log("Error sending message to content script:", chrome.runtime.lastError.message);
          // Open popup with just the selected text if available
          openPopupWithDetails(info.selectionText || '', {
            title: tab.title || '',
            date: '',
            time: '',
            location: ''
          });
        }
        // The success response will come via the processSelectedText action
      });
    } catch (error) {
      console.error("Failed to communicate with content script:", error);
      // Fall back to selection text if available
      openPopupWithDetails(info.selectionText || '', {
        title: tab.title || '',
        date: '',
        time: '',
        location: ''
      });
    }
  }
});

// Open popup when extension icon is clicked
chrome.action.onClicked.addListener(tab => {
  try {
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, response => {
      if (chrome.runtime.lastError) {
        console.log("Error sending message to content script:", chrome.runtime.lastError.message);
        // Open popup with just the selected text if available
        openPopupWithDetails('', {
          title: tab.title || '',
          date: '',
          time: '',
          location: ''
        });
      }
    });
  } catch (error) {
    console.error("Failed to communicate with content script:", error);
    // Fall back to selection text if available
    openPopupWithDetails('', {
      title: tab.title || '',
      date: '',
      time: '',
      location: ''
    });
  }
});

// Helper function to open popup with event details
function openPopupWithDetails(selectedText, eventDetails) {
  const width = 380;
  const height = 480; // Default height

  // Construct URL for the popup with parameters
  const popupURL = chrome.runtime.getURL("src/html/popup.html") + 
    `?text=${encodeURIComponent(selectedText || "")}` + 
    `&title=${encodeURIComponent(eventDetails.title || "")}` + 
    `&date=${encodeURIComponent(eventDetails.date || "")}` + 
    `&time=${encodeURIComponent(eventDetails.time || "")}` + 
    `&location=${encodeURIComponent(eventDetails.location || "")}`;
  
  // Create a popup window
  chrome.windows.create({
    url: popupURL,
    type: "popup",
    width: width,
    height: height,
    focused: true
  }, (window) => {
    // Resize the window after it's loaded to fit content
    if (window && window.id) {
      chrome.storage.local.set({ 
        popupWindowId: window.id,
        needsResize: true // Flag to indicate window needs resizing
      });
    }
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "processSelectedText") {
    // Open popup with extracted details
    openPopupWithDetails(message.selectedText || '', message.eventDetails || {});
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