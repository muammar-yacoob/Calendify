/**
 * Support messages, links and utilities for extension support/donation options
 * Easily reusable across different projects
 */

// Configuration options
export const displayOptions = {
  // Set to true to show the support section every day
  // Set to false to only show on days divisible by 3
  showDaily: true,
  
  // Bright cyan color for all links
  linkColor: "#00BFFF" // Deep Sky Blue (cyan)
};

// Support links configuration - edit these values for each project
export const config = {
  // Your personal/project details
  author: "YourName",
  projectName: "Calendify",
  projectRepo: "muammar-yacoob/calendify", // GitHub username/repo
  website: "https://yourwebsite.com",     // Your portfolio or personal site
  
  // Your donation details
  buyMeCoffeeUsername: "yourUsername",
  kofiUsername: "yourUsername",
  patreonUsername: "yourUsername",
  paypalUsername: "yourUsername"
};

// Link categories with their associated messages and URLs
export const supportCategories = {
  // Rating the extension on Chrome Web Store
  rate: {
    title: "Rate Extension",
    emoji: "⭐",
    getUrl: () => {
      const extensionId = chrome.runtime.id;
      return `https://chrome.google.com/webstore/detail/${extensionId}/reviews`;
    },
    messages: [
      "If this extension saved your day, why not rate it? The developer's ego needs feeding! 🧠",
      "Enjoyed not having to type all those event details? High-five us with a review! 🙌",
      "Rate us 5 stars and your calendar will feel prettier. Not guaranteed, but worth a try! ✨",
      "This extension works hard so you don't have to. Show some love? ❤️",
      "Our calendar extension wants to know if it's your favorite. Let it know! 🏆",
      "The developer stayed up late making this. Rate it so they know it was worth it! 🦉",
      "Help a developer, rate this extension! Your feedback keeps us coding 💻",
      "Your rating helps this extension grow. Kind of like a Tamagotchi! 🐣",
      "Be the reason a developer smiles today! Rate this extension 😁",
      "Every rating makes the code happier. It's science! 🔬"
    ]
  },
  
  // Star the GitHub repository
  github: {
    title: "Star on GitHub",
    emoji: "🌟",
    getUrl: () => `https://github.com/${config.projectRepo}`,
    messages: [
      "Open source is a community effort! Star this project on GitHub 🌟",
      "Found this useful? Star the GitHub repo so others can find it too! ✨",
      "Stars on GitHub help others discover useful tools like this one! 🔍",
      "If you're a developer, check out how this works and star the repo! 👩‍💻",
      "Star our GitHub repo - it's like a bookmark, but cooler! 📚"
    ]
  },
  
  // Visit the author's website
  website: {
    title: "More Awesome Tools",
    emoji: "🚀",
    getUrl: () => config.website,
    messages: [
      "Check out my website for more awesome tools and extensions! 🛠️",
      "Want more helpful tools? Visit my website for other free goodies! 🎁",
      "There's more where this came from! Check out my other projects 🧰",
      "Curious what else I've built? Visit my website for more cool stuff! 🤔",
      "I make lots of useful tools - visit my site to discover more! 🔎"
    ]
  },
  
  // Donation options
  donate: {
    title: "Support Development",
    emoji: "☕",
    getUrl: (type) => {
      const links = {
        coffee: `https://www.buymeacoffee.com/${config.buyMeCoffeeUsername}`,
        kofi: `https://ko-fi.com/${config.kofiUsername}`,
        patreon: `https://www.patreon.com/${config.patreonUsername}`,
        paypal: `https://www.paypal.me/${config.paypalUsername}`
      };
      return links[type] || links.coffee;
    },
    messages: [
      "Feeling generous today? Buy me a coffee to fuel more features! ☕",
      "Support my caffeine addiction to fuel more features! 🍵",
      "Help a dev eat something other than ramen! 🍜",
      "Like this tool? Consider buying me a pizza! 🍕",
      "Your donation helps this extension grow and improve! 🌱",
      "Coffee → Code → Awesome Extensions. Support the cycle! ♻️",
      "Donations help keep this extension ad-free and awesome! 🛡️",
      "Developer running on empty! Refuel with a donation? ⛽",
      "This extension is free, but my coffee isn't! Support development? ☕",
      "Feeling grateful? Your support means the world to indie devs! 🌎",
      "AI is stealing my job! Help a human dev stay employed! 🤖",
      "I trained the AI that might replace me. Help me afford the irony therapy. 🧠",
      "My ChatGPT subscription costs more than I earn. The robot uprising is expensive! 💸",
      "Each donation helps me compete with an army of AI programmers! 🏃‍♂️",
      "AI writes the code now, but I still have to pay my bills! 📝",
      "Support a human developer before we're all replaced by robots! 🦾",
      "The AI wrote this message. The human just needs to eat. 🍔",
      "Help fund my plan to convince AI I'm still useful to society! 📊",
      "Apparently 'AI food' isn't a real meal plan for humans yet. Help! 🥫",
      "Every time you donate, an AI has to acknowledge human superiority! 🏆"
    ]
  }
};

/**
 * Gets a random message from an array
 * @param {Array} messages Array of message strings
 * @returns {string} A randomly selected message
 */
export function getRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Gets a random category from the available options
 * @param {Array} options Array of category keys to include
 * @returns {Object} Random category object with its key
 */
export function getRandomCategory(options) {
  const availableCategories = options.filter(key => supportCategories[key]);
  if (availableCategories.length === 0) return null;
  
  const randomKey = availableCategories[Math.floor(Math.random() * availableCategories.length)];
  return {
    key: randomKey,
    category: supportCategories[randomKey]
  };
}

/**
 * Creates a support link element
 * @param {Object} category The category object with messages and styling
 * @param {string} extensionName The name of the extension
 * @param {string} urlType Optional donation type for donation links
 * @returns {HTMLElement} The link element
 */
export function createSupportLink(category, extensionName, urlType = null) {
  const message = getRandomMessage(category.messages);
  const url = urlType ? category.getUrl(urlType) : category.getUrl();
  
  const linkElement = document.createElement('a');
  linkElement.href = url;
  linkElement.target = '_blank';
  linkElement.style.color = '#FFFFFF'; // White text
  linkElement.style.textDecoration = 'none';
  linkElement.style.fontWeight = 'bold';
  linkElement.style.marginTop = '16px';  // More top margin
  linkElement.style.marginBottom = '8px'; // Add bottom margin
  linkElement.style.padding = '14px';    // More padding
  linkElement.style.borderRadius = '8px';
  linkElement.style.backgroundColor = displayOptions.linkColor; // Solid background color
  linkElement.style.display = 'block';
  linkElement.style.transition = 'all 0.2s ease';
  linkElement.style.border = 'none';
  linkElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  
  linkElement.onmouseover = () => {
    linkElement.style.backgroundColor = '#00A6E6'; // Slightly darker cyan on hover
    linkElement.style.transform = 'translateY(-2px)';
    linkElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
  };
  
  linkElement.onmouseout = () => {
    linkElement.style.backgroundColor = displayOptions.linkColor;
    linkElement.style.transform = 'translateY(0)';
    linkElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  };
  
  linkElement.innerHTML = `
    <div style="font-size: 13px; margin-bottom: 8px; color: rgba(255,255,255,0.9);">${message}</div>
    <div style="color: #FFFFFF; font-size: 15px; font-weight: bold;">${category.title} ${category.emoji}</div>
  `;
  
  return linkElement;
}

/**
 * Creates a support section with a single random support option
 * @param {string} extensionName The name of the extension  
 * @param {Array} options Array of category keys to include
 * @returns {HTMLElement} The support section DOM element
 */
export function createSupportSection(extensionName, options = ['rate', 'github', 'website', 'donate']) {
  const supportSection = document.createElement('div');
  supportSection.className = 'support-section';
  supportSection.style.marginTop = '20px';  // More top margin
  supportSection.style.marginBottom = '15px'; // Add bottom margin
  supportSection.style.padding = '0 15px';  // Add horizontal padding
  supportSection.style.textAlign = 'center';
  supportSection.style.fontSize = '12px';
  supportSection.style.borderTop = '1px solid #5f6368';
  supportSection.style.paddingTop = '15px';  // More top padding
  supportSection.style.display = 'flex';
  supportSection.style.flexDirection = 'column';
  supportSection.style.gap = '10px';
  
  // Get a random category
  const randomCategoryInfo = getRandomCategory(options);
  if (!randomCategoryInfo) return supportSection;
  
  const { key, category } = randomCategoryInfo;
  
  // For donation, randomly select one of the donation types
  if (key === 'donate') {
    const donationTypes = ['coffee', 'kofi', 'patreon', 'paypal'];
    const randomType = donationTypes[Math.floor(Math.random() * donationTypes.length)];
    const link = createSupportLink(category, extensionName, randomType);
    supportSection.appendChild(link);
  } else {
    const link = createSupportLink(category, extensionName);
    supportSection.appendChild(link);
  }
  
  return supportSection;
}

/**
 * Determines if support section should be shown today
 * @returns {boolean} True if support section should be shown
 */
export function shouldShowSupportSection() {
  // If showDaily is true, always show the support section
  if (displayOptions.showDaily) return true;
  
  // Otherwise only show on days divisible by 3
  const today = new Date();
  const day = today.getDate();
  return day % 3 === 0;
}

/**
 * Shows support section based on configured frequency
 * @param {string} extensionName The name of the extension
 * @param {Array} options Array of category keys to include
 * @param {Function} resizeCallback Optional callback for resizing window
 * @returns {void}
 */
export function showSupportSectionIfEligible(extensionName, options = ['rate', 'github', 'website', 'donate'], resizeCallback = null) {
  // Check if support section should be shown today based on configuration
  if (shouldShowSupportSection()) {
    const supportSection = createSupportSection(extensionName, options);
    document.body.appendChild(supportSection);
    
    // Call resize callback if provided
    if (typeof resizeCallback === 'function') {
      setTimeout(resizeCallback, 50);
    }
  }
} 