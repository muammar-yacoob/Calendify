document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');
  
  // Get parameters from URL and prefill form
  const urlParams = new URLSearchParams(window.location.search);
  const prefilled = {
    text: urlParams.get('text') || '',
    title: urlParams.get('title') || '',
    date: urlParams.get('date') || '',
    time: urlParams.get('time') || '',
    location: urlParams.get('location') || ''
  };
  
  // Set default date if not provided
  if (!prefilled.date) {
    prefilled.date = new Date().toISOString().split('T')[0];
  }
  
  // Prefill form fields
  document.getElementById('eventDescription').value = prefilled.text;
  document.getElementById('eventTitle').value = prefilled.title;
  document.getElementById('eventDate').value = prefilled.date;
  document.getElementById('eventTime').value = prefilled.time;
  document.getElementById('eventLocation').value = prefilled.location;
  
  // If any critical fields are missing, try to parse from selected text
  if (!prefilled.title || !prefilled.time || !prefilled.location) {
    if (prefilled.text) {
      const extractedDetails = parseEventDetails(prefilled.text);
      
      // Only use parsed values for fields that weren't prefilled
      if (!prefilled.title && extractedDetails.title) {
        document.getElementById('eventTitle').value = extractedDetails.title;
      }
      if (!prefilled.date && extractedDetails.date) {
        document.getElementById('eventDate').value = extractedDetails.date;
      }
      if (!prefilled.time && extractedDetails.time) {
        document.getElementById('eventTime').value = extractedDetails.time;
      }
      if (!prefilled.location && extractedDetails.location) {
        document.getElementById('eventLocation').value = extractedDetails.location;
      }
    }
  }

  // Handle add to calendar button click
  document.getElementById('addButton').addEventListener('click', () => {
    const eventDetails = {
      title: document.getElementById('eventTitle').value,
      date: document.getElementById('eventDate').value,
      time: document.getElementById('eventTime').value,
      location: document.getElementById('eventLocation').value,
      description: document.getElementById('eventDescription').value
    };

    // Validate required fields
    if (!eventDetails.title) {
      showNotification('Please enter an event title', 'error');
      return;
    }

    // Send event details to background script
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
});

// Parse event details from text
function parseEventDetails(text) {
  const eventDetails = { title: null, date: null, time: null, location: null };
  
  // Extract title (first substantial line)
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  for (const line of lines) {
    if (line.length > 5 && !line.match(/date|time|location/i) && !line.match(/^\d+:\d+$/)) {
      eventDetails.title = line.trim();
      break;
    }
  }
  
  // Extract date and time
  // Try to find weekday pattern first (e.g., "Wednesday at 15:00")
  const weekdayMatch = text.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+at\s+(\d{1,2}):(\d{2})\b/i);
  if (weekdayMatch) {
    // Set date to next occurrence of that day
    const dayNames = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 
      'friday': 5, 'saturday': 6, 'sunday': 0
    };
    const today = new Date();
    const targetDay = dayNames[weekdayMatch[1].toLowerCase()];
    const daysToAdd = (targetDay + 7 - today.getDay()) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToAdd);
    
    eventDetails.date = targetDate.toISOString().split('T')[0];
    eventDetails.time = `${weekdayMatch[2].padStart(2, '0')}:${weekdayMatch[3]}`;
  } else {
    // Try to find other date formats
    const dateMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const monthNames = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
        'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      const month = monthNames[dateMatch[2].toLowerCase().substring(0, 3)];
      const year = dateMatch[3];
      eventDetails.date = `${year}-${month}-${day}`;
    }
    
    // Try to find time
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      eventDetails.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
  }
  
  // Extract location
  const locationMatch = text.match(/location:?\s+([^\n]+)/i);
  if (locationMatch) {
    eventDetails.location = locationMatch[1].trim();
  }
  
  return eventDetails;
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