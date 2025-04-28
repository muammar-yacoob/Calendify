// Setup context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToCalendar",
    title: "Calendify",
    contexts: ["selection", "page"]
  });
});

// Check if we can access the content script
async function canAccessContentScript(tabId) {
  if (!tabId) return false;
  
  try {
    // Get the tab info to check if it's a supported page
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:')) {
      console.log("Cannot access content script on this page type:", tab.url);
      return false;
    }
    
    // Try to ping the content script
    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, { action: "ping" }, response => {
          if (chrome.runtime.lastError) {
            console.log("Content script not available:", chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          
          console.log("Content script responded:", response);
          resolve(!!response && response.success);
        });
        
        // Set a timeout to handle cases where the message doesn't get a response
        setTimeout(() => resolve(false), 500);
      } catch (error) {
        console.error("Error pinging content script:", error);
        resolve(false);
      }
    });
  } catch (error) {
    console.error("Error checking tab:", error);
    return false;
  }
}

// Try to inject content script and get data
async function getPageData(tabId) {
  if (!tabId) {
    console.log("No valid tab ID provided");
    return null;
  }
  
  try {
    // Get tab info to make sure we can inject scripts
    const tab = await chrome.tabs.get(tabId);
    
    // Check if we can inject scripts into this tab
    if (!tab.url || tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:')) {
      console.log("Cannot inject scripts into this type of page:", tab.url);
      return null;
    }
    
    console.log("Attempting to inject content script into tab:", tabId);
    
    // Try to inject the content script using the scripting API
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/js/content.js']
      });
      console.log("Content script injection successful");
    } catch (injectionError) {
      console.error("Content script injection failed:", injectionError);
      // Continue anyway - the content script might already be loaded
    }
    
    // Wait a moment for the script to initialize if it was just injected
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Now try to get data from the content script
    return new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, { action: "getSelection" }, response => {
        if (chrome.runtime.lastError) {
          console.log("Error getting page data:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        
        if (response && response.success) {
          console.log("Successfully got page data:", response.eventDetails);
          resolve(response.eventDetails);
        } else {
          console.log("Failed to get page data from content script");
          resolve(null);
        }
      });
      
      // Timeout for safety
      setTimeout(() => {
        console.log("Timeout waiting for content script response");
        resolve(null);
      }, 1000);
    });
  } catch (error) {
    console.error("Error in getPageData:", error);
    return null;
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addToCalendar") {
    console.log("Context menu clicked on tab:", tab?.id);
    
    // Get selection text directly from the info object if available
    let initialData = {};
    if (info.selectionText) {
      initialData.text = info.selectionText;
      initialData.title = info.selectionText.split('\n')[0];
    }
    
    // Try to get more detailed data from the page
    const pageData = await getPageData(tab?.id);
    
    // Use whatever data we could get
    openPopup(pageData || initialData);
  }
});

// Open popup when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Extension icon clicked on tab:", tab?.id);
  
  // Try to get data from the page
  const pageData = await getPageData(tab?.id);
  
  // Open popup with whatever data we could get
  openPopup(pageData || {});
});

// Helper function to open popup with event details
function openPopup(eventDetails) {
  const width = 320;  // Adjusted width to provide proper spacing
  const height = 410; // Increased dimensions to prevent squashing

  // Construct URL for the popup with parameters
  let popupURL = chrome.runtime.getURL("src/html/popup.html");
  
  // Add query parameters if we have event details
  if (eventDetails) {
    popupURL += `?text=${encodeURIComponent(eventDetails.text || "")}` + 
      `&title=${encodeURIComponent(eventDetails.title || "")}` + 
      `&date=${encodeURIComponent(eventDetails.date || "")}` + 
      `&time=${encodeURIComponent(eventDetails.time || "")}` + 
      `&location=${encodeURIComponent(eventDetails.location || "")}`;
      
    // Add meeting link if available
    if (eventDetails.meetingLink) {
      popupURL += `&meetingLink=${encodeURIComponent(eventDetails.meetingLink)}`;
    }
    
    // Add description if available
    if (eventDetails.description) {
      popupURL += `&description=${encodeURIComponent(eventDetails.description)}`;
    }
  }
  
  console.log("Opening popup with URL:", popupURL);
  
  // Create a popup window with fixed size
  chrome.windows.create({
    url: popupURL,
    type: "popup",
    width: width,
    height: height,
    focused: true
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addToCalendar") {
    // Format event details for Google Calendar URL
    const eventDetails = message.eventDetails;
    const gcalUrl = createGoogleCalendarUrl(eventDetails);
    
    // Open Google Calendar in a new tab
    chrome.tabs.create({ url: gcalUrl }, (tab) => {
      console.log('Opened Google Calendar with event details');
      // Show a system notification
      showSystemNotification(
        "Event Added to Calendar", 
        `"${eventDetails.title}" has been added to your Google Calendar.`,
        "success"
      );
      sendResponse({ success: true });
    });
    
    return true; // Keep the messaging channel open for async response
  }
});

// Show a system notification using Chrome's Notifications API
function showSystemNotification(title, message, type = 'basic') {
  const iconPath = type === 'success' 
    ? chrome.runtime.getURL("res/icons/icon128.png")
    : chrome.runtime.getURL("res/icons/icon128.png");
  
  const notificationOptions = {
    type: 'basic',
    title: title,
    message: message,
    iconUrl: iconPath,
    priority: 2
  };
  
  // Generate a unique ID based on current time
  const notificationId = 'calendify-' + Date.now();
  
  // Create the notification
  chrome.notifications.create(notificationId, notificationOptions, (id) => {
    console.log('Notification shown with ID:', id);
    
    // Auto-clear after 5 seconds
    setTimeout(() => {
      chrome.notifications.clear(id);
    }, 5000);
  });
}

// Create Google Calendar URL with event details
function createGoogleCalendarUrl(eventDetails) {
  console.log("Creating Google Calendar URL with event details:", eventDetails);
  
  const baseUrl = 'https://calendar.google.com/calendar/render';
  const action = 'action=TEMPLATE';
  
  // Format title
  const title = encodeURIComponent(eventDetails.title || 'New Event');
  
  // Format dates
  let dates = '';
  if (eventDetails.date) {
    // Make sure date is in YYYY-MM-DD format
    let dateStr = eventDetails.date;
    // Convert any other formats to YYYY-MM-DD
    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      try {
        const dateObj = new Date(dateStr);
        if (!isNaN(dateObj.getTime())) {
          dateStr = dateObj.toISOString().split('T')[0];
        }
      } catch (e) {
        console.error("Error parsing date:", e);
      }
    }
    
    // Convert to YYYYMMDD format for Google Calendar
    const startDate = dateStr.replace(/-/g, '');
    
    // Handle time if provided
    if (eventDetails.time && eventDetails.time.match(/^\d{1,2}:\d{2}$/)) {
      // Format: HH:MM
      const timeParts = eventDetails.time.split(':');
      const hours = timeParts[0].padStart(2, '0');
      const minutes = timeParts[1];
      
      // Create start datetime
      dates = `${startDate}T${hours}${minutes}00`;
      
      // Create end datetime (1 hour later by default)
      const endHour = (parseInt(hours) + 1) % 24;
      const endTime = `${endHour.toString().padStart(2, '0')}${minutes}00`;
      dates += `/${startDate}T${endTime}`;
    } else {
      // All day event
      dates = `${startDate}/${startDate}`;
    }
  } else {
    // If no date provided, use today's date
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    dates = `${year}${month}${day}/${year}${month}${day}`;
  }
  
  // Check if we have a Google Meet link
  const hasGoogleMeetLink = eventDetails.meetingLink && 
    eventDetails.meetingLink.includes('meet.google.com');
  
  // If we have a Google Meet link, use the special add parameter
  let conferenceParam = '';
  if (hasGoogleMeetLink) {
    // Extract the meeting code from the URL
    const meetCode = eventDetails.meetingLink.match(/meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)/i);
    if (meetCode && meetCode[1]) {
      console.log("Adding Google Meet conference:", meetCode[1]);
      conferenceParam = `&add=meet.google.com_${meetCode[1].replace(/-/g, '')}`;
      
      // Remove the meetingLink from location if it's there
      if (eventDetails.location && eventDetails.location.includes(eventDetails.meetingLink)) {
        eventDetails.location = eventDetails.location.replace(` | ${eventDetails.meetingLink}`, '');
        if (eventDetails.location === 'Online Event') {
          eventDetails.location = 'Google Meet';
        }
      }
    }
  }
  
  // Format location and description
  const location = encodeURIComponent(eventDetails.location || '');
  
  // Prepare description - include meeting link if available and it's not a Google Meet link
  let description = eventDetails.description || eventDetails.text || '';
  
  // If we have a meetingLink that's not Google Meet and it's not already in the description
  if (eventDetails.meetingLink && !hasGoogleMeetLink && !description.includes(eventDetails.meetingLink)) {
    if (description) description += '\n\n';
    description += `Meeting Link: ${eventDetails.meetingLink}`;
  }
  
  console.log('Final description for Google Calendar:', description);
  
  // Encode the final description
  const details = encodeURIComponent(description);
  
  // Construct URL
  const params = [
    action,
    `text=${title}`,
    `dates=${dates}`,
    `location=${location}`,
    `details=${details}`
  ].join('&');
  
  // Add conference parameter if it exists
  const finalUrl = `${baseUrl}?${params}${conferenceParam}`;
  console.log("Google Calendar URL created:", finalUrl);
  return finalUrl;
}