console.log('Content script loaded');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSelectedText") {
    // Get selected text or scan page if none is selected
    const selectedText = window.getSelection().toString().trim() || '';
    const eventDetails = extractEventDetailsFromDOM();
    
    console.log('Sending extracted details:', eventDetails);
    
    // Send extracted details back to background script
    chrome.runtime.sendMessage({
      action: "processSelectedText",
      selectedText: selectedText,
      eventDetails: eventDetails
    });
  }
});

// Extract event details from DOM elements
function extractEventDetailsFromDOM() {
  console.log('Extracting event details from DOM');
  const eventDetails = { title: null, date: null, time: null, location: null };
  
  try {
    // Only check visible, substantial elements
    const allElements = Array.from(document.querySelectorAll('*')).filter(el => {
      // Skip hidden elements
      if (el.offsetParent === null && !['HTML', 'BODY'].includes(el.tagName)) return false;
      
      // Skip small elements
      const rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 10) return false;
      
      return true;
    });
    
    // First pass: look for obvious event elements with known classes
    const knownEventClasses = ['event-title', 'event-name', 'event-date', 'event-time', 'event-location'];
    
    // Try to find elements with the known classes
    try {
      for (const className of knownEventClasses) {
        // Use try-catch for each query to avoid issues with malformed selectors
        try {
          const elements = document.querySelectorAll(`.${className}, [class*="${className}"]`);
          for (const el of elements) {
            const text = el.textContent.trim();
            if (!text) continue;
            
            if (className.includes('title') || className.includes('name')) {
              eventDetails.title = text;
            } else if (className.includes('date')) {
              // Extract date using regex if needed
              const dateMatch = text.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/);
              if (dateMatch) {
                // Simple conversion to ISO format - can be improved
                const parts = dateMatch[0].split(/[\/-]/);
                if (parts.length === 3) {
                  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                  eventDetails.date = `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
              }
            } else if (className.includes('time')) {
              const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
              if (timeMatch) {
                eventDetails.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
              }
            } else if (className.includes('location')) {
              eventDetails.location = text;
            }
          }
        } catch (selectorError) {
          console.log(`Error with selector for class '${className}':`, selectorError);
          // Continue with next class
          continue;
        }
      }
    } catch (classSearchError) {
      console.log('Error searching for elements with specific classes:', classSearchError);
      // Continue with other extraction methods
    }
    
    // Second pass: look for headings and prominent text for title
    if (!eventDetails.title) {
      for (const element of allElements) {
        if (element.tagName.match(/^H[1-3]$/)) {
          const text = element.textContent.trim();
          if (text.length > 5 && text.length < 100 && 
              !shouldSkipElement(element, text) &&
              !text.toLowerCase().match(/date|time|location|when|where/i)) {
            eventDetails.title = text;
            break;
          }
        }
      }
    }
    
    // Third pass: scan all elements for date/time patterns
    if (!eventDetails.date || !eventDetails.time) {
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
      
      for (const element of allElements) {
        const text = element.textContent.trim();
        if (shouldSkipElement(element, text)) continue;
        
        // Try each regex pattern
        for (const { pattern, handler } of dateTimeRegexes) {
          const matches = text.match(pattern);
          if (matches) {
            const result = handler(matches);
            // Only override if not already set
            if (!eventDetails.date && result.date) eventDetails.date = result.date;
            if (!eventDetails.time && result.time) eventDetails.time = result.time;
            
            // If we have both date and time, break the loop
            if (eventDetails.date && eventDetails.time) break;
          }
        }
        
        // If we've found date and time, break the loop
        if (eventDetails.date && eventDetails.time) break;
      }
      
      // Fallback: Look for any time pattern
      if (!eventDetails.time) {
        for (const element of allElements) {
          const text = element.textContent.trim();
          if (shouldSkipElement(element, text)) continue;
          
          const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
          if (timeMatch) {
            eventDetails.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
            break;
          }
        }
      }
    }
    
    // Extract location from known patterns or labels
    if (!eventDetails.location) {
      const locationKeywords = ['location:', 'venue:', 'where:', 'address:', 'place:'];
      
      for (const element of allElements) {
        const text = element.textContent.trim();
        if (shouldSkipElement(element, text)) continue;
        
        const textLower = text.toLowerCase();
        
        // Check if text includes any of the location keywords
        const matchedKeyword = locationKeywords.find(keyword => textLower.includes(keyword));
        
        if (matchedKeyword) {
          // Get the text after the keyword
          let locationText = text.split(new RegExp(matchedKeyword, 'i'))[1]?.trim();
          
          if (locationText && locationText.length > 0) {
            eventDetails.location = locationText;
            break;
          }
        } else if (textLower === 'location' || textLower === 'venue' || textLower === 'where') {
          // If it's just a label, try to get the next element or parent's text
          const nextEl = element.nextElementSibling;
          const parentEl = element.parentElement;
          
          if (nextEl && nextEl.textContent.trim()) {
            eventDetails.location = nextEl.textContent.trim();
            break;
          } else if (parentEl && parentEl.textContent.includes(textLower)) {
            // Get parent's text excluding the label
            const pattern = new RegExp(`${textLower}:?`, 'i');
            eventDetails.location = parentEl.textContent.replace(pattern, '').trim();
            break;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error extracting event details:', error);
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

// Helper function to safely get element class name as a string
function getElementClassNameString(element) {
  if (!element) return '';
  
  // Check if className is a string or an object (SVG elements have an object)
  if (typeof element.className === 'string') {
    return element.className;
  } else if (element.className && element.className.baseVal !== undefined) {
    // SVG elements have className.baseVal
    return element.className.baseVal;
  } else if (element.getAttribute) {
    // Fallback to getAttribute
    return element.getAttribute('class') || '';
  }
  
  return '';
}

// Helper function to determine if an element should be skipped
function shouldSkipElement(element, text) {
  // Skip empty text
  if (!text || text.length === 0) return true;
  
  // Skip common promotional texts
  const promoTexts = ['sales end soon', 'promoted', 'sold out', 'free', 'tickets', 'price', 'from £'];
  if (promoTexts.some(promo => text.toLowerCase().includes(promo))) return true;
  
  // Skip elements with certain classes
  const classNameStr = getElementClassNameString(element);
  const classNameLower = classNameStr.toLowerCase();
  const skipClasses = ['urgency', 'promoted', 'price', 'sold', 'ticket', 'sale'];
  if (skipClasses.some(cls => classNameLower.includes(cls))) return true;
  
  // Skip elements that are likely promotional
  const style = element.getAttribute('style') || '';
  if (style.includes('darkreader') || style.includes('--Typography')) return true;
  
  return false;
}

// Extract event details on page load
setTimeout(() => {
  const eventDetails = extractEventDetailsFromDOM();
  chrome.storage.local.set({ lastExtractedDetails: eventDetails });
  console.log('Initial extraction:', eventDetails);
}, 1000);