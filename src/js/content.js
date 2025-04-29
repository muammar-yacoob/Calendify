// Calendify Content Script
console.log('Calendify content script loaded');

// Message handler for extension communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ success: true });
  } else if (message.action === "getSelection") {
    try {
      const eventDetails = extractEventData();
      console.log('Extracted data:', JSON.stringify(eventDetails, null, 2));
      sendResponse({ success: true, eventDetails });
    } catch (error) {
      console.error('Error extracting event data:', error);
      sendResponse({ 
        success: false, 
        error: error.message,
        eventDetails: {
          title: document.title,
          text: window.getSelection().toString().trim()
        }
      });
    }
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
    meetingLink: "",
    isOnline: false,
    description: "",
    text: window.getSelection().toString().trim()
  };
  
  // Parse selected text with priority for description
  if (data.text) {
    data.description = data.text;
    parseSelectedText(data);
  }
  
  // Get page title as fallback
  const pageTitle = findElementContent('[itemprop="name"]') || 
                    findElementContent('h1') || 
                    document.title.replace(/\s*[\|\-:—].*$/, '').trim();
  
  if (!data.title) data.title = pageTitle;
  if (!data.date) data.date = findDate();
  if (!data.time) data.time = findTime();
  
  // Check if online event and get meeting link if appropriate
  const isLikelyOnlineEvent = checkIfOnlineEvent();
  
  if (isLikelyOnlineEvent === true) {
    const meetingInfo = findMeetingLink();
    
    if (meetingInfo?.url) {
      data.isOnline = true;
      data.meetingLink = meetingInfo.url;
      data.description += data.description ? '\n\nMeeting Link: ' + data.meetingLink : '';
      data.location = meetingInfo.platform && meetingInfo.platform !== 'Conference' ? 
        `Online Event (${meetingInfo.platform})` : "Online Event";
    }
  }
  
  // Find physical location if not already determined to be online
  if (!data.location) {
    data.location = findLocation();
  }
  
  // Handle hybrid events (both physical and online)
  if (data.location && data.location !== "Online Event" && data.meetingLink && 
      !data.location.includes(data.meetingLink)) {
    data.location = `${data.location} | ${data.meetingLink}`;
  }
  
  // Get better description if needed
  if (!data.description || data.description.length < 50) {
    const extractedDescription = findDescription();
    if (extractedDescription && extractedDescription.length > data.description.length) {
      data.description = extractedDescription;
      if (data.meetingLink && !data.description.includes(data.meetingLink)) {
        data.description += '\n\nMeeting Link: ' + data.meetingLink;
      }
    }
  }
  
  // Ensure no object references in data
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      data[key] = JSON.stringify(data[key]);
    }
  }
  
  return data;
}

// Helper functions
function findElementContent(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : null;
}

function getVisibleElements(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(el => 
    el.offsetParent !== null && el.textContent.trim().length > 5);
}

function getMonthNumber(monthName) {
  const months = { 
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' 
  };
  return months[monthName.substring(0, 3).toLowerCase()] || '01';
}

// Parse selected text for event details
function parseSelectedText(data) {
  const text = data.text;
  
  // Find dates like "Sun, 2 Nov, 10:00"
  const dateMatch = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s*(\d{1,2}):(\d{2})\b/i);
  
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = getMonthNumber(dateMatch[2]);
    data.date = `${new Date().getFullYear()}-${month}-${day}`;
    data.time = `${dateMatch[3].padStart(2, '0')}:${dateMatch[4]}`;
  }
  
  // Find location
  const locationMatch = text.match(/(?:location|venue|place|at)[\s:]+([^\n,\.]+)/i);
  if (locationMatch) {
    data.location = locationMatch[1].trim();
  }
}

// Find the most likely date
function findDate() {
  // Try structured data first
  const datetimeEl = document.querySelector('[itemprop="startDate"], [datetime], time[datetime]');
  if (datetimeEl) {
    const datetimeStr = datetimeEl.getAttribute('datetime') || datetimeEl.getAttribute('content');
    if (datetimeStr) {
      try {
        const dateObj = new Date(datetimeStr);
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString().split('T')[0];
        }
      } catch (e) {}
    }
  }
  
  // Try common date elements
  const dateEl = document.querySelector('.date, .event-date, .datetime');
  if (dateEl) {
    const text = dateEl.textContent.trim();
    const dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}|\d{2})/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      return `${year}-${month}-${day}`;
    }
  }
  
  // Look for date patterns in text
  const paragraphs = getVisibleElements('p, span, div');
  for (const el of paragraphs) {
    const text = el.textContent.trim();
    const dateMatch = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = getMonthNumber(dateMatch[2]);
      return `${new Date().getFullYear()}-${month}-${day}`;
    }
  }
  
  return "";
}

// Find the most likely time
function findTime() {
  const timeEl = document.querySelector('.time, .event-time');
  if (timeEl) {
    const text = timeEl.textContent.trim();
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
  }
  
  // Look for time patterns in text
  const paragraphs = getVisibleElements('p, span, div');
  for (const el of paragraphs) {
    const text = el.textContent.trim();
    const timeMatch = text.match(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = timeMatch[2];
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === 'pm' && hour < 12) hour += 12;
      else if (ampm === 'am' && hour === 12) hour = 0;
      
      return `${hour.toString().padStart(2, '0')}:${minute}`;
    }
  }
  
  return "";
}

// Find the most likely location
function findLocation() {
  // Function to clean up address text
  function cleanAddressText(text) {
    return text.replace(/Show map.*$/i, '')
              .replace(/\s+/g, ' ')
              .replace(/Get directions.*$/i, '')
              .trim();
  }
  
  // Try structured address data first
  const addressElements = document.querySelectorAll('[itemtype*="PostalAddress"], [itemprop="address"], [itemprop="location"]');
  for (const el of addressElements) {
    if (el.offsetParent === null) continue;
    
    // Try to find specific address parts
    const streetAddress = el.querySelector('[itemprop="streetAddress"]');
    const locality = el.querySelector('[itemprop="addressLocality"]');
    const region = el.querySelector('[itemprop="addressRegion"]');
    const postalCode = el.querySelector('[itemprop="postalCode"]');
    
    // Build address from structured parts
    if (streetAddress || locality || region || postalCode) {
      const parts = [streetAddress, locality, region, postalCode]
        .filter(part => part)
        .map(part => part.textContent.trim());
      
      const fullAddress = parts.join(', ');
      if (fullAddress) return fullAddress;
    }
    
    // Use full element text if no structured parts
    const addressText = cleanAddressText(el.textContent);
    if (addressText.length > 5) return addressText;
  }
  
  // Try common location classes
  const locationSelectors = [
    '.location-info__address',
    '.address-info',
    '.venue-address',
    '.location, .venue, .place, .event-location'
  ];
  
  for (const selector of locationSelectors) {
    const elements = getVisibleElements(selector);
    for (const el of elements) {
      const text = cleanAddressText(el.textContent);
      if (text.length > 3) return text;
    }
  }
  
  // Look for postal code patterns
  const postalPatterns = [
    /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i, // UK
    /\b\d{5}(-\d{4})?\b/,                        // US
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i              // Canada
  ];
  
  const paragraphs = getVisibleElements('p, div, span');
  for (const el of paragraphs) {
    const text = el.textContent.trim();
    for (const pattern of postalPatterns) {
      if (pattern.test(text) && text.length < 200) {
        return cleanAddressText(text);
      }
    }
  }
  
  // Look for "Location: X" pattern
  for (const el of paragraphs) {
    const text = el.textContent;
    const locationMatch = text.match(/(?:location|venue|place|at|where)[\s:]+([^\n,\.]+(?:[^\n]*(?:street|road|ave|lane|blvd|drive|dr|st|rd|avenue))?)/i);
    if (locationMatch) {
      return cleanAddressText(locationMatch[1]);
    }
  }
  
  return "";
}

// Check if this is likely an online event
function checkIfOnlineEvent() {
  const pageText = document.body.textContent.toLowerCase();
  
  const onlineIndicators = [
    'online event', 'virtual event', 'webinar', 'zoom meeting', 'teams meeting', 
    'remote attendance', 'web conference', 'virtual conference'
  ];
  
  const inPersonIndicators = [
    'in-person only', 'physical attendance', 'venue address',
    'parking available', 'directions to venue'
  ];
  
  let onlineScore = 0, inPersonScore = 0;
  
  // Check strong indicators
  onlineIndicators.forEach(indicator => {
    if (pageText.includes(indicator)) onlineScore += 2;
  });
  
  ['virtual', 'online', 'zoom', 'teams', 'meet', 'web', 'remote'].forEach(word => {
    if (new RegExp(`\\b${word}\\b`, 'i').test(pageText)) onlineScore += 1;
  });
  
  inPersonIndicators.forEach(indicator => {
    if (pageText.includes(indicator)) inPersonScore += 2;
  });
  
  // Check elements indicating online events
  if (document.querySelectorAll('.online-event, .virtual-event, [class*="online-"], [class*="virtual-"]').length > 0) {
    onlineScore += 2;
  }
  
  // Check metadata
  const metaEventType = document.querySelector('meta[property="event:type"], [itemprop="eventAttendanceMode"]');
  if (metaEventType) {
    const eventType = metaEventType.getAttribute('content') || metaEventType.textContent;
    if (/online|virtual|remote/i.test(eventType)) {
      onlineScore += 3;
    } else if (/in-?person|physical|offline/i.test(eventType)) {
      inPersonScore += 3;
    }
  }
  
  if (onlineScore >= 3 && onlineScore > inPersonScore) return true;
  if (inPersonScore >= 2) return false;
  
  return null;
}

// Find online meeting links
function findMeetingLink() {
  const links = Array.from(document.getElementsByTagName('a'));
  
  // Meeting platform patterns
  const meetingPatterns = [
    { type: 'Zoom', regex: /zoom\.us\/(j|w|webinar|meeting|register)\/([a-zA-Z0-9?=_-]+)/i },
    { type: 'Teams', regex: /teams\.microsoft\.com\/l\/(meetup-join|meet|meeting)/i },
    { type: 'Meet', regex: /meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i },
    { type: 'Webex', regex: /webex\.com\/(meet|j|join|meeting)/i },
    { type: 'GoToMeeting', regex: /goto(meeting|webinar)\.com/i }
  ];
  
  // Check links against patterns
  for (const link of links) {
    const href = link.href;
    if (!href || href.length < 10) continue;
    
    // Skip social media links
    if (href.match(/facebook\.com|twitter\.com|instagram\.com|linkedin\.com/i)) continue;
    
    for (const pattern of meetingPatterns) {
      if (pattern.regex.test(href)) {
        return { platform: pattern.type, url: href };
      }
    }
    
    // Check if text suggests this is a meeting link
    const linkText = link.textContent.toLowerCase();
    if (/\b(join|register|online|virtual|zoom|teams|meet|webinar)\b/i.test(linkText)) {
      return { platform: 'Conference', url: href };
    }
  }
  
  // Try to find meeting links in text
  const paragraphs = getVisibleElements('p, span, div');
  for (const el of paragraphs) {
    const text = el.textContent;
    
    // Look for explicit meeting URLs
    const meetLinkMatch = text.match(/https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i) ||
                          text.match(/https:\/\/([a-z0-9.-]+\.)?zoom\.us\/(j|w|webinar|meeting)\/[a-zA-Z0-9?=_-]+/i) ||
                          text.match(/https:\/\/teams\.microsoft\.com\/l\/(meetup-join|meet|meeting)[^\s]*/i);
    
    if (meetLinkMatch) {
      const url = meetLinkMatch[0];
      const platform = url.includes('zoom') ? 'Zoom' : 
                        url.includes('meet.google') ? 'Meet' : 'Teams';
      return { platform, url };
    }
    
    // Look for meeting IDs
    const meetingIdMatch = text.match(/meeting\s+id:?\s*(\d{9,})/i);
    if (meetingIdMatch) {
      return {
        platform: 'Zoom',
        url: `https://zoom.us/j/${meetingIdMatch[1]}`
      };
    }
  }
  
  return null;
}

// Find description content
function findDescription() {
  // Try structured data first
  const structuredDesc = document.querySelector('[itemprop="description"], [property="og:description"], meta[name="description"]');
  if (structuredDesc) {
    const content = structuredDesc.getAttribute('content') || structuredDesc.textContent;
    if (content?.trim().length > 20) return content.trim();
  }
  
  // Try common description selectors
  const descElements = getVisibleElements('.event-description, .description, .about, .event-details, .content, [class*="description"]');
  for (const el of descElements) {
    // Skip navigation, header and very small elements
    if (el.closest('nav, header') || el.textContent.trim().length < 50) continue;
    
    const text = el.textContent.trim();
    if (text.length > 50 && text.length < 5000) return text;
  }
  
  // Find substantial paragraphs
  const paragraphs = Array.from(document.querySelectorAll('p')).filter(p => 
    p.offsetParent !== null && 
    p.textContent.trim().length > 100 && 
    p.textContent.trim().length < 3000 && 
    !p.closest('header, footer, nav'));
  
  if (paragraphs.length > 0) {
    // Get the longest paragraph
    return paragraphs.sort((a, b) => b.textContent.length - a.textContent.length)[0].textContent.trim();
  }
  
  return null;
}

// Perform initial extraction on page load
setTimeout(() => {
  const eventDetails = extractEventData();
  console.log('Initial data extraction:', eventDetails);
}, 1000);