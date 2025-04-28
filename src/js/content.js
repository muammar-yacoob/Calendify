// Calendify Content Script - Simplified
console.log('Calendify content script loaded');

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ success: true });
  } else if (message.action === "getSelection") {
    try {
      console.log('Extracting event data...');
      const eventDetails = extractEventData();
      console.log('Extracted data:', JSON.stringify(eventDetails, null, 2));
      
      // Verify meetingLink is being set correctly
      if (eventDetails.meetingLink) {
        console.log('Meeting link found:', eventDetails.meetingLink);
        console.log('Location is set to:', eventDetails.location);
      } else {
        console.log('No meeting link found');
      }
      
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
  
  // 1. Selected text has priority for description
  if (data.text) {
    console.log('Selected text:', data.text);
    data.description = data.text;
    parseSelectedText(data);
  }
  
  // 2. Find missing data in the DOM
  // Always get the page title so we have it as a fallback
  const pageTitle = findPageTitle();
  
  // If no title was found in selected text, use the page title
  if (!data.title) {
    data.title = pageTitle;
  }
  
  if (!data.date) data.date = findDate();
  if (!data.time) data.time = findTime();
  
  // 3. Only look for meeting links if we have strong evidence this is an online event
  // This helps prevent falsely identifying regular links as meeting links
  const isLikelyOnlineEvent = checkIfOnlineEvent();
  
  if (isLikelyOnlineEvent === true) {
    console.log('This appears to be an online event, looking for meeting links...');
    const meetingInfo = findMeetingLink();
    
    if (meetingInfo && typeof meetingInfo === 'object') {
      // Only set meetingLink and online status if we have a valid URL
      if (meetingInfo.url) {
        data.isOnline = true;
        data.meetingLink = meetingInfo.url;
        
        // Add meeting link to description
        if (data.description) {
          data.description += '\n\n';
        }
        data.description += `Meeting Link: ${data.meetingLink}`;
        
        // Only set location to "Online Event" if we actually have a meeting URL
        if (meetingInfo.platform && meetingInfo.platform !== 'Conference') {
          data.location = `Online Event (${meetingInfo.platform})`;
        } else {
          data.location = "Online Event";
        }
      }
    }
  } else {
    console.log('This does not appear to be an online event, skipping meeting link detection');
  }
  
  // 4. Find physical location if not already determined to be online
  if (!data.location) {
    data.location = findLocation();
  }
  
  // 5. If we have both a physical location and a meeting link, it's likely a hybrid event
  if (data.location && data.location !== "Online Event" && data.meetingLink && !data.location.includes(data.meetingLink)) {
    data.location = `${data.location} | ${data.meetingLink}`;
  }
  
  // 6. Try to extract a proper description if we don't have one yet
  if (!data.description || data.description.length < 50) {
    const extractedDescription = findDescription();
    if (extractedDescription && extractedDescription.length > data.description.length) {
      // If the selected text is short, replace it with the better description
      data.description = extractedDescription;
      
      // Re-add the meeting link to the new description if needed
      if (data.meetingLink && !data.description.includes(data.meetingLink)) {
        data.description += '\n\nMeeting Link: ' + data.meetingLink;
      }
    }
  }
  
  // Final validation to ensure no Object references are in the data
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      console.warn(`Converting object in ${key} to string:`, data[key]);
      data[key] = JSON.stringify(data[key]);
    }
  }
  
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
  console.log('Looking for event title...');
  
  // Try multiple strategies to find a title
  const strategies = [
    // Try structured data
    () => {
      const el = document.querySelector('[itemprop="name"]');
      if (el && el.textContent.trim()) {
        console.log('Found title in structured data:', el.textContent.trim());
        return el.textContent.trim();
      }
      return null;
    },
    
    // Try common heading elements
    () => {
      const el = document.querySelector('h1');
      if (el && el.textContent.trim()) {
        console.log('Found title in h1:', el.textContent.trim());
        return el.textContent.trim();
      }
      return null;
    },
    
    // Try event-specific classes
    () => {
      const el = document.querySelector('.event-title, .title, .event-name, .event-header, [class*="event-title"], [class*="event-name"]');
      if (el && el.textContent.trim()) {
        console.log('Found title in event-specific class:', el.textContent.trim());
        return el.textContent.trim();
      }
      return null;
    },
    
    // Try meta tags
    () => {
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle && metaTitle.getAttribute('content')) {
        console.log('Found title in meta tag:', metaTitle.getAttribute('content'));
        return metaTitle.getAttribute('content');
      }
      return null;
    },
    
    // Fallback to page title, with some cleaning
    () => {
      const pageTitle = document.title;
      // Clean up the page title by removing site name, etc.
      let cleanTitle = pageTitle
        .replace(/\s*\|\s*.*$/, '') // Remove "| Site name"
        .replace(/\s*-\s*.*$/, '') // Remove "- Site name"
        .replace(/\s*—\s*.*$/, '') // Remove "— Site name" (em dash)
        .replace(/\s*:\s*.*$/, '') // Remove ": subtitle"
        .trim();
        
      // If cleaning removed everything, use the original title
      if (!cleanTitle || cleanTitle.length < 3) {
        cleanTitle = pageTitle;
      }
      
      console.log('Using page title as fallback:', cleanTitle);
      return cleanTitle;
    }
  ];
  
  // Try each strategy in order
  for (const strategy of strategies) {
    const result = strategy();
    if (result) {
      return result;
    }
  }
  
  // This should never happen as the last strategy always returns something
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
  console.log('Looking for location information...');
  
  // Priority 0: Look for specific location classes like "location-info__address"
  const specificLocationSelectors = [
    '.location-info__address',
    '.location-info',
    '.address-info',
    '.event-location-info',
    '.venue-address',
    '.address-text',
    '.location-address',
    '[class*="location-info"]',
    '[class*="address"]',
    '[itemprop="address"]',
    '[itemprop="location"]'
  ];
  
  // Function to clean up address text
  function cleanAddressText(text) {
    return text.replace(/Show map.*$/i, '')
              .replace(/\s+/g, ' ')
              .replace(/Get directions.*$/i, '')
              .trim();
  }
  
  // First look for structured address data which is most reliable
  const addressElements = document.querySelectorAll('[itemtype*="PostalAddress"], [itemprop="address"], [itemprop="location"]');
  for (const el of addressElements) {
    if (el.offsetParent === null) continue; // Skip hidden elements
    
    // Try to find specific address parts from structured data
    const streetAddress = el.querySelector('[itemprop="streetAddress"]');
    const locality = el.querySelector('[itemprop="addressLocality"]');
    const region = el.querySelector('[itemprop="addressRegion"]');
    const postalCode = el.querySelector('[itemprop="postalCode"]');
    const country = el.querySelector('[itemprop="addressCountry"]');
    
    // If we found structured parts, build a proper address
    if (streetAddress || locality || region || postalCode) {
      let address = [];
      if (streetAddress) address.push(streetAddress.textContent.trim());
      if (locality) address.push(locality.textContent.trim());
      if (region) address.push(region.textContent.trim());
      if (postalCode) address.push(postalCode.textContent.trim());
      if (country) address.push(country.textContent.trim());
      
      const fullAddress = address.join(', ');
      if (fullAddress) {
        console.log('Found structured address data:', fullAddress);
        return fullAddress;
      }
    }
    
    // If no structured parts but we have address text, use it
    const addressText = cleanAddressText(el.textContent);
    if (addressText && addressText.length > 5) {
      console.log('Found address in structured data element:', addressText);
      return addressText;
    }
  }
  
  // Check for specific location elements with dedicated class names
  for (const selector of specificLocationSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el.offsetParent === null) continue; // Skip hidden elements
      
      const text = el.textContent.trim();
      // Filter out very short texts and those with controls/buttons
      if (text && text.length > 3 && !text.includes('Show map')) {
        // Try to clean up the text
        let cleanText = cleanAddressText(text);
        
        // If we have a multi-line address, preserve newlines by replacing with commas
        if (el.innerHTML.includes('<br')) {
          cleanText = el.innerHTML.replace(/<br\s*\/?>/gi, ', ')
                                 .replace(/<[^>]*>/g, '')  // Remove other HTML tags
                                 .replace(/\s+/g, ' ')      // Replace multiple spaces
                                 .replace(/,\s*,/g, ',')    // Remove empty commas
                                 .trim();
        }
        
        console.log('Found location in specific selector:', selector, cleanText);
        return cleanText;
      }
    }
  }
  
  // Look for elements containing postal codes - strong indicator of an address
  const postalCodePatterns = [
    /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i, // UK Postal Code
    /\b\d{5}(-\d{4})?\b/,                        // US Zip Code
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i,             // Canadian Postal Code
    /\b\d{4}\s*[A-Z]{2}\b/i,                     // Dutch Postal Code
    /\b\d{2}-\d{3}\b/                            // Polish Postal Code
  ];
  
  const paragraphs = Array.from(document.querySelectorAll('p, div, span')).filter(el => {
    return el.offsetParent !== null && el.textContent.trim().length > 5;
  });
  
  // Try each paragraph to see if it contains a postal code
  for (const el of paragraphs) {
    const text = el.textContent.trim();
    
    // Check against postal code patterns
    for (const pattern of postalCodePatterns) {
      if (pattern.test(text)) {
        // If a paragraph contains a postal code, it's likely an address
        // But we want to ensure it's not too long (like a paragraph with an address)
        if (text.length < 200) {
          console.log('Found text with postal code, likely an address:', text);
          
          // Check if there's a parent element that might contain the full address
          let parent = el.parentElement;
          if (parent && parent.textContent.length < 300) {
            // If parent is not much larger than the element, use parent text
            // as it might contain the complete address
            const parentText = cleanAddressText(parent.textContent);
            if (parentText.length > text.length * 1.2) {
              console.log('Using parent element for more complete address:', parentText);
              return parentText;
            }
          }
          
          return cleanAddressText(text);
        }
      }
    }
  }
  
  // Look for elements with common location class names or text indicators
  const locationElements = document.querySelectorAll('.location, .venue, .place, .event-location');
  for (const el of locationElements) {
    if (el.offsetParent === null) continue;
    const location = cleanAddressText(el.textContent);
    if (location && location.length > 3) {
      console.log('Found location in common element:', location);
      return location;
    }
  }
  
  // Look for "Location: X" pattern in text
  for (const el of paragraphs) {
    const text = el.textContent;
    const locationMatch = text.match(/(?:location|venue|place|at|where)[\s:]+([^\n,\.]+(?:[^\n]*(?:street|road|ave|lane|blvd|drive|dr|st|rd|avenue|plaza|square|court|ct|way|place|pl|boulevard|terrace|ter))?)/i);
    if (locationMatch) {
      const location = cleanAddressText(locationMatch[1]);
      console.log('Found location pattern in text:', location);
      return location;
    }
  }
  
  return "";
}

// Find online meeting links like Zoom, Teams, Google Meet, etc.
function findMeetingLink() {
  console.log('Looking for meeting links...');
  
  // Find all links on the page
  const links = Array.from(document.getElementsByTagName('a'));
  
  // Common patterns for meeting links - strict patterns to avoid false positives
  const meetingPatterns = [
    // Zoom (including webinar and registration links)
    { type: 'Zoom', regex: /zoom\.us\/(j|w|webinar|meeting|register)\/([a-zA-Z0-9?=_-]+)/i, confidence: 'high' },
    // Microsoft Teams
    { type: 'Teams', regex: /teams\.microsoft\.com\/l\/(meetup-join|meet|meeting)/i, confidence: 'high' },
    // Google Meet
    { type: 'Meet', regex: /meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i, confidence: 'high' },
    // Webex
    { type: 'Webex', regex: /webex\.com\/(meet|j|join|meeting)/i, confidence: 'high' },
    // GoToMeeting/GoToWebinar
    { type: 'GoToMeeting', regex: /goto(meeting|webinar)\.com/i, confidence: 'high' },
    // Skype
    { type: 'Skype', regex: /join\.skype\.com/i, confidence: 'high' },
    // Meetup - but only if we're sure it's an online event
    { type: 'Meetup', regex: /meetup\.com\/[^\/]+\/events\/\d+/i, confidence: 'medium' },
    // Generic conference link patterns - low confidence to avoid false positives
    { type: 'Conference', regex: /\/webinar|\/conference\/join/i, confidence: 'low' }
  ];
  
  console.log('Scanning links for meeting URLs...');
  
  // Check each link against our patterns
  for (const link of links) {
    const href = link.href;
    if (!href || href.length < 10) continue; // Skip empty or very short URLs
    
    // Exclude common non-meeting URLs to avoid false positives
    if (href.match(/facebook\.com|twitter\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com/i)) {
      continue;
    }
    
    // Look for links that are clearly about joining or registering for online meetings
    const linkText = link.textContent.toLowerCase();
    const isJoinLink = linkText.match(/\b(join|register|sign up|attend|online|virtual|zoom|teams|meet|webinar)\b/i);
    
    for (const pattern of meetingPatterns) {
      if (pattern.regex.test(href)) {
        // Higher confidence for high-confidence patterns like Zoom, Meet, etc.
        if (pattern.confidence === 'high') {
          console.log(`Found high-confidence ${pattern.type} meeting link:`, href);
          return {
            platform: pattern.type,
            url: href
          };
        }
        
        // For medium-confidence patterns, check if link text suggests it's for joining
        if (pattern.confidence === 'medium' && isJoinLink) {
          console.log(`Found medium-confidence ${pattern.type} meeting link with join text:`, href);
          return {
            platform: pattern.type,
            url: href
          };
        }
        
        // For low-confidence patterns, require explicit join/register text
        if (pattern.confidence === 'low' && isJoinLink && 
            (linkText.includes('join') || linkText.includes('register') || linkText.includes('attend'))) {
          console.log(`Found low-confidence ${pattern.type} meeting link with explicit join text:`, href);
          return {
            platform: pattern.type,
            url: href
          };
        }
      }
    }
  }
  
  // If no link found, try to find it in text content with high confidence patterns only
  const paragraphs = Array.from(document.querySelectorAll('p, span, div')).filter(el => {
    return el.offsetParent !== null;
  }).map(el => el.textContent.trim());
  
  for (const text of paragraphs) {
    // Only look for explicit meeting URLs in text - high confidence patterns only
    const meetLinkMatch = text.match(/https:\/\/meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i);
    const zoomLinkMatch = text.match(/https:\/\/([a-z0-9.-]+\.)?zoom\.us\/(j|w|webinar|meeting)\/[a-zA-Z0-9?=_-]+/i);
    const teamsLinkMatch = text.match(/https:\/\/teams\.microsoft\.com\/l\/(meetup-join|meet|meeting)[^\s]*/i);
    
    if (meetLinkMatch) {
      console.log('Found Google Meet link in text:', meetLinkMatch[0]);
      return {
        platform: 'Meet',
        url: meetLinkMatch[0]
      };
    }
    
    if (zoomLinkMatch) {
      console.log('Found Zoom link in text:', zoomLinkMatch[0]);
      return {
        platform: 'Zoom',
        url: zoomLinkMatch[0]
      };
    }
    
    if (teamsLinkMatch) {
      console.log('Found Teams link in text:', teamsLinkMatch[0]);
      return {
        platform: 'Teams',
        url: teamsLinkMatch[0]
      };
    }
    
    // Look for meeting IDs with explicit meeting ID label
    const meetingIdMatch = text.match(/meeting\s+id:?\s*(\d{9,})/i);
    if (meetingIdMatch) {
      const meetingId = meetingIdMatch[1];
      console.log('Found Zoom meeting ID:', meetingId);
      return {
        platform: 'Zoom',
        url: `https://zoom.us/j/${meetingId}`
      };
    }
  }
  
  console.log('No meeting link found');
  return null;
}

// Check if this is likely an online event based on page content
function checkIfOnlineEvent() {
  // Look for explicit indicators in the page
  const pageText = document.body.textContent.toLowerCase();
  
  // Strong indicators this is an online event (very specific phrases)
  const strongOnlineIndicators = [
    'online event', 'virtual event', 'webinar', 
    'zoom meeting', 'teams meeting', 'google meet',
    'join online', 'join virtually', 'virtual conference',
    'online only', 'virtual attendance', 'web conference',
    'join remotely', 'remote attendance', 'attend from anywhere'
  ];
  
  // Strong indicators this is an in-person event
  const inPersonIndicators = [
    'in-person only', 'physical attendance', 'venue address',
    'parking available', 'venue location', 'attend in person',
    'directions to venue', 'parking information', 'venue map',
    'directions to the venue', 'physical location'
  ];
  
  // Count how many strong online indicators we find
  let onlineIndicatorCount = 0;
  for (const indicator of strongOnlineIndicators) {
    if (pageText.includes(indicator)) {
      console.log('Strong online event indicator found:', indicator);
      onlineIndicatorCount += 2; // Give more weight to strong indicators
    }
  }
  
  // Check for weaker online indicators (individual words that together suggest an online event)
  const weakOnlineIndicators = ['virtual', 'online', 'zoom', 'teams', 'meet', 'web', 'remote'];
  for (const indicator of weakOnlineIndicators) {
    // Use word boundary check to avoid matching words like "meeting" when looking for "meet"
    const regex = new RegExp(`\\b${indicator}\\b`, 'i');
    if (regex.test(pageText)) {
      console.log('Weak online event indicator found:', indicator);
      onlineIndicatorCount += 1;
    }
  }
  
  // Check for in-person event indicators
  let inPersonIndicatorCount = 0;
  for (const indicator of inPersonIndicators) {
    if (pageText.includes(indicator)) {
      console.log('In-person event indicator found:', indicator);
      inPersonIndicatorCount += 2;
    }
  }
  
  // Look for specific elements that indicate online events
  const onlineElements = document.querySelectorAll(
    '.online-event, .virtual-event, [class*="online-"], [class*="virtual-"]'
  );
  
  if (onlineElements.length > 0) {
    console.log('Found elements suggesting an online event');
    onlineIndicatorCount += 2;
  }
  
  // Check meta tags or structured data for event type
  const metaEventType = document.querySelector('meta[property="event:type"], [itemprop="eventAttendanceMode"]');
  if (metaEventType) {
    const eventTypeValue = metaEventType.getAttribute('content') || metaEventType.textContent;
    if (eventTypeValue) {
      if (/online|virtual|remote/i.test(eventTypeValue)) {
        console.log('Found event type metadata indicating online event:', eventTypeValue);
        onlineIndicatorCount += 3; // Strong signal from metadata
      } else if (/in-?person|physical|offline|on-?site/i.test(eventTypeValue)) {
        console.log('Found event type metadata indicating in-person event:', eventTypeValue);
        inPersonIndicatorCount += 3;
      }
    }
  }
  
  console.log(`Online indicators: ${onlineIndicatorCount}, In-person indicators: ${inPersonIndicatorCount}`);
  
  // Decide based on indicator counts
  if (onlineIndicatorCount >= 3 && onlineIndicatorCount > inPersonIndicatorCount) {
    return true;  // Likely an online event
  } else if (inPersonIndicatorCount >= 2) {
    return false; // Likely an in-person event
  }
  
  // If we can't determine for sure, return null (undetermined)
  return null;
}

// Detect which platform a meeting URL belongs to
function detectPlatform(url) {
  if (!url) return 'Unknown';
  
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('zoom.us')) return 'Zoom';
  if (lowerUrl.includes('teams.microsoft.com')) return 'Teams';
  if (lowerUrl.includes('meet.google.com')) return 'Meet';
  if (lowerUrl.includes('webex.com')) return 'Webex';
  if (lowerUrl.includes('gotomeeting.com')) return 'GoToMeeting';
  if (lowerUrl.includes('gotowebinar.com')) return 'GoToWebinar';
  if (lowerUrl.includes('join.skype.com')) return 'Skype';
  if (lowerUrl.includes('register') || lowerUrl.includes('registration')) return 'Registration';
  return 'Conference';
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

// Find description content from the page
function findDescription() {
  console.log('Looking for event description...');
  
  // Try to find description in structured data first
  const structuredDesc = document.querySelector('[itemprop="description"], [property="og:description"], meta[name="description"]');
  if (structuredDesc) {
    const content = structuredDesc.getAttribute('content') || structuredDesc.textContent;
    if (content && content.trim().length > 20) {
      console.log('Found description in structured data:', content.substring(0, 50) + '...');
      return content.trim();
    }
  }
  
  // Try common description selectors
  const descSelectors = [
    '.event-description', '.description', '.about', '.event-about',
    '.details', '.event-details', '.content', '.event-content',
    '[class*="description"]', '[class*="about-event"]', '[class*="event-about"]'
  ];
  
  for (const selector of descSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el.offsetParent === null) continue; // Skip hidden elements
      
      // Skip navigation, header and very small elements
      if (el.closest('nav, header') || el.textContent.trim().length < 20) continue;
      
      const text = el.textContent.trim();
      if (text && text.length > 50 && text.length < 5000) {
        console.log('Found description in element:', selector, text.substring(0, 50) + '...');
        return text;
      }
    }
  }
  
  // Try to find the first substantial paragraph after the event details
  // First find the event details container (date/time/location)
  const dateTimeElements = document.querySelectorAll('.date, .time, .datetime, .when, [itemprop="startDate"]');
  for (const dateEl of dateTimeElements) {
    if (dateEl.offsetParent === null) continue;
    
    // Try to find parent container that might hold the event details
    let parent = dateEl.parentElement;
    for (let i = 0; i < 3 && parent; i++) { // Look up to 3 levels up
      // Look for paragraphs after this container
      let sibling = parent.nextElementSibling;
      while (sibling) {
        // Check if this is a content paragraph
        if ((sibling.tagName === 'P' || sibling.tagName === 'DIV') && 
            !sibling.querySelector('input, button, select, a.btn') && // Not an interactive element
            sibling.textContent.trim().length > 50) {
          const text = sibling.textContent.trim();
          console.log('Found description paragraph after event details:', text.substring(0, 50) + '...');
          return text;
        }
        sibling = sibling.nextElementSibling;
      }
      parent = parent.parentElement;
    }
  }
  
  // If all else fails, try to find a substantial paragraph anywhere on the page
  const paragraphs = Array.from(document.querySelectorAll('p')).filter(p => {
    return p.offsetParent !== null && // Visible
           p.textContent.trim().length > 100 && // Substantial text
           p.textContent.trim().length < 3000 && // Not too long
           !p.closest('header, footer, nav'); // Not in navigation
  });
  
  if (paragraphs.length > 0) {
    // Sort by length (descending) to find the most substantial paragraph
    paragraphs.sort((a, b) => b.textContent.length - a.textContent.length);
    const text = paragraphs[0].textContent.trim();
    console.log('Found substantial paragraph:', text.substring(0, 50) + '...');
    return text;
  }
  
  return null;
}

// Extract data when page loads
setTimeout(() => {
  const eventDetails = extractEventData();
  console.log('Initial page data extraction:', eventDetails);
  chrome.storage.local.set({ lastExtractedDetails: eventDetails });
}, 1000);