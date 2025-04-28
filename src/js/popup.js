document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');
  
  // Get parameters from URL and prefill form
  const urlParams = new URLSearchParams(window.location.search);
  const prefilled = {
    text: urlParams.get('text') || '',
    title: urlParams.get('title') || '',
    date: urlParams.get('date') || '',
    time: urlParams.get('time') || '',
    location: urlParams.get('location') || '',
    meetingLink: urlParams.get('meetingLink') || '',
    description: urlParams.get('description') || ''
  };
  
  // Get form elements
  const eventTitleEl = document.getElementById('eventTitle');
  const eventDateEl = document.getElementById('eventDate');
  const eventTimeEl = document.getElementById('eventTime');
  const eventLocationEl = document.getElementById('eventLocation');
  const eventDescriptionEl = document.getElementById('eventDescription');
  const addButtonEl = document.getElementById('addButton');
  
  // Set form fields
  eventTitleEl.value = prefilled.title;
  eventDateEl.value = prefilled.date;
  eventTimeEl.value = prefilled.time;
  
  // Handle location and meeting link
  if (prefilled.location) {
    eventLocationEl.value = prefilled.location;
  } else if (prefilled.meetingLink) {
    eventLocationEl.value = `Online Event | ${prefilled.meetingLink}`;
  }
  
  // Handle description and include meeting link if available
  let description = prefilled.description || prefilled.text || '';
  
  // If we have a meeting link and it's not already in the description
  if (prefilled.meetingLink && !description.includes(prefilled.meetingLink)) {
    if (description) description += '\n\n';
    description += `Meeting Link: ${prefilled.meetingLink}`;
  }
  
  eventDescriptionEl.value = description;
  const meetingLinkValue = prefilled.meetingLink || '';
  
  // Process text for missing fields if needed
  if (prefilled.text && (!prefilled.title || !prefilled.date || !prefilled.time || !prefilled.location)) {
    const extractedDetails = parseEventDetails(prefilled.text);
    
    // Only use parsed values for empty fields
    if (!prefilled.title && extractedDetails.title) eventTitleEl.value = extractedDetails.title;
    if (!prefilled.date && extractedDetails.date) eventDateEl.value = extractedDetails.date;
    if (!prefilled.time && extractedDetails.time) eventTimeEl.value = extractedDetails.time;
    if (!eventLocationEl.value && extractedDetails.location) eventLocationEl.value = extractedDetails.location;
    if (!eventLocationEl.value && isLikelyOnlineEvent(prefilled.text)) eventLocationEl.value = "Online Event";
  }
  
  // Validate form and update button state
  function validateForm() {
    const isValid = eventTitleEl.value.trim() !== '' && eventDateEl.value.trim() !== '';
    addButtonEl.disabled = !isValid;
    addButtonEl.style.opacity = isValid ? '1' : '0.5';
    addButtonEl.style.cursor = isValid ? 'pointer' : 'not-allowed';
    return isValid;
  }
  
  // Add listeners and perform initial validation
  eventTitleEl.addEventListener('input', validateForm);
  eventDateEl.addEventListener('input', validateForm);
  validateForm();
  
  // Adjust window size
  setTimeout(() => adjustWindowSize(), 200);
  
  // Handle add to calendar button click
  addButtonEl.addEventListener('click', () => {
    if (!validateForm()) {
      showNotification('Title and date are required', 'error');
      return;
    }
    
    const eventDetails = {
      title: eventTitleEl.value,
      date: eventDateEl.value,
      time: eventTimeEl.value,
      location: eventLocationEl.value,
      description: eventDescriptionEl.value,
      meetingLink: meetingLinkValue
    };

    chrome.runtime.sendMessage({
      action: "addToCalendar",
      eventDetails: eventDetails
    }, (response) => {
      if (response && response.success) {
        showNotification('Event added to calendar!');
        setTimeout(() => window.close(), 1500);
      } else {
        showNotification('Failed to add event to calendar', 'error');
      }
    });
  });
  
  // Add compact support section
  loadCompactSupportLinks();
});

// Load support links in a more compact format
async function loadCompactSupportLinks() {
  try {
    let supportLinksModule;
    try {
      supportLinksModule = await import('./utils/supportLinks.js');
    } catch (e) {
      try {
        supportLinksModule = await import('../js/utils/supportLinks.js');
      } catch (e2) {
        const modulePath = chrome.runtime.getURL('src/js/utils/supportLinks.js');
        supportLinksModule = await import(modulePath);
      }
    }
    
    if (!supportLinksModule) return;
    
    const manifest = await (await fetch(chrome.runtime.getURL('manifest.json'))).json();
    const extensionName = manifest.name || 'Calendify';
    
    // Get the support container from the HTML
    const supportContainer = document.getElementById('supportContainer');
    if (!supportContainer) {
      console.error('Support container not found');
      return;
    }
    
    // Get a random category
    const options = ['rate', 'github', 'website', 'donate'];
    const randomCategoryInfo = supportLinksModule.getRandomCategory(options);
    if (!randomCategoryInfo) return;
    
    const { category } = randomCategoryInfo;
    
    // Create text element - compact
    const textEl = document.createElement('div');
    textEl.classList.add('support-text');
    
    // Get a shorter message
    let message = supportLinksModule.getRandomMessage(category.messages);
    // Truncate message if too long
    if (message.length > 70) {
      message = message.substring(0, 67) + '...';
    }
    textEl.textContent = message;
    
    // Create button element - compact
    const buttonEl = document.createElement('a');
    buttonEl.classList.add('support-button');
    buttonEl.href = category.getUrl();
    buttonEl.target = '_blank';
    buttonEl.textContent = `${category.title} ${category.emoji}`;
    
    // Add elements to the support container
    supportContainer.appendChild(textEl);
    supportContainer.appendChild(buttonEl);
    
    // Adjust window size after adding support section
    setTimeout(() => adjustWindowSize(), 50);
  } catch (error) {
    console.error('Error loading support utilities:', error);
    
    // Add a simple fallback if there's an error
    const supportContainer = document.getElementById('supportContainer');
    if (supportContainer) {
      supportContainer.textContent = 'Thanks for using Calendify! ⭐';
      supportContainer.style.fontSize = '10px';
      supportContainer.style.textAlign = 'center';
    }
  }
}

// Adjust window size to fit content
function adjustWindowSize() {
  const contentHeight = document.body.scrollHeight;
  if (contentHeight > 0) {
    // Use more compact sizing with less padding
    const targetHeight = Math.min(Math.max(contentHeight + 20, 320), 480);
    chrome.windows.getCurrent((window) => {
      if (window) {
        chrome.windows.update(window.id, { height: targetHeight });
      }
    });
  }
}

// Parse event details from text
function parseEventDetails(text) {
  const eventDetails = { title: null, date: null, time: null, location: null };
  
  // Extract title (first substantial line)
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  for (const line of lines) {
    // Look for substantial text that isn't just metadata or timestamps
    if (line.length > 5 && line.length < 100 && 
        !line.toLowerCase().match(/date|time|location|when|where/i) && 
        !line.match(/^\d{1,2}:\d{2}$/) &&
        !line.match(/^(mon|tue|wed|thu|fri|sat|sun)/i)) {
      eventDetails.title = line.trim();
      break;
    }
  }
  
  // Extract date and time with improved regex patterns
  const dateTimeRegexes = [
    // Format: "Sun, 2 Nov, 10:00" or similar variants
    {
      pattern: /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s*(\d{1,2}):(\d{2})\b/i,
      handler: (matches) => {
        const day = parseInt(matches[2], 10).toString().padStart(2, '0');
        const month = getMonthNumber(matches[3]);
        const year = new Date().getFullYear();
        
        return {
          date: `${year}-${month}-${day}`,
          time: `${matches[4].padStart(2, '0')}:${matches[5]}`
        };
      }
    },
    // Format: "Weekday at 15:00"
    {
      pattern: /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+at\s+(\d{1,2}):(\d{2})\b/i,
      handler: (matches) => {
        const dayNames = {
          'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 
          'friday': 5, 'saturday': 6, 'sunday': 0
        };
        const today = new Date();
        const targetDay = dayNames[matches[1].toLowerCase()];
        const daysToAdd = (targetDay + 7 - today.getDay()) % 7;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysToAdd);
        
        return {
          date: targetDate.toISOString().split('T')[0],
          time: `${matches[2].padStart(2, '0')}:${matches[3]}`
        };
      }
    },
    // Format: "DD Month YYYY"
    {
      pattern: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
      handler: (matches) => {
        const day = matches[1].padStart(2, '0');
        const month = getMonthNumber(matches[2]);
        const year = matches[3];
        
        return {
          date: `${year}-${month}-${day}`,
          time: null
        };
      }
    }
  ];
  
  // Try each regex pattern
  for (const { pattern, handler } of dateTimeRegexes) {
    const matches = text.match(pattern);
    if (matches) {
      const result = handler(matches);
      if (result.date) eventDetails.date = result.date;
      if (result.time) eventDetails.time = result.time;
      
      // If we have both date and time, break the loop
      if (eventDetails.date && eventDetails.time) break;
    }
  }
  
  // If no time found yet but there's a time in the text
  if (!eventDetails.time) {
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      eventDetails.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
  }
  
  // Extract location
  const locationKeywords = ['location:', 'venue:', 'where:', 'address:', 'place:'];
  
  // Check if text includes any of the location keywords
  for (const keyword of locationKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      const parts = text.split(new RegExp(keyword, 'i'));
      if (parts.length > 1) {
        // Get the text after the keyword until the next newline
        const locationText = parts[1].split('\n')[0].trim();
        if (locationText) {
          eventDetails.location = locationText;
          break;
        }
      }
    }
  }
  
  return eventDetails;
}

// Helper function to get month number from name
function getMonthNumber(monthName) {
  const months = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };
  return months[monthName.toLowerCase().substring(0, 3)];
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  if (!notification) {
    console.error('Notification element not found!');
    return;
  }
  
  notification.textContent = message;
  notification.style.backgroundColor = type === 'error' ? '#f28b82' : '#8ab4f8';
  notification.classList.add('show');
  setTimeout(() => notification.classList.remove('show'), 3000);
}

// Check if text suggests this is an online event
function isLikelyOnlineEvent(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  const onlineKeywords = [
    'online event', 'virtual event', 'webinar', 
    'zoom', 'teams', 'google meet', 'webex',
    'join online', 'virtual', 'web conference',
    'online session', 'online workshop'
  ];
  
  for (const keyword of onlineKeywords) {
    if (lowerText.includes(keyword)) {
      console.log('Text suggests online event:', keyword);
      return true;
    }
  }
  
  // Check for meeting links in the text
  const meetingLinkRegex = /(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)/i;
  if (meetingLinkRegex.test(lowerText)) {
    console.log('Text contains meeting link');
    return true;
  }
  
  return false;
}