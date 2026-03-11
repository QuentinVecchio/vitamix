/**
 * Generative Search Block
 * Integrates with Cloudflare Worker API to generate dynamic content based on user queries
 */

// API Configuration
const API_BASE_URL = 'https://vitamix-gen-service.franklin-prod.workers.dev';

/**
 * Creates the search interface
 * @param {HTMLElement} block - The block element
 */
function createSearchInterface(block) {
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  searchContainer.innerHTML = `
    <form class="search-form">
      <input
        type="text"
        class="search-input"
        placeholder="Ask me anything about Vitamix products..."
        aria-label="Search query"
        required
      />
      <button type="submit" class="search-button">
        Generate
      </button>
    </form>
  `;

  return searchContainer;
}

/**
 * Creates the results container
 * @returns {HTMLElement} Results container element
 */
function createResultsContainer() {
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container hidden';

  resultsContainer.innerHTML = `
    <div class="status-message hidden"></div>
    <div class="generation-events hidden"></div>
    <div class="content-preview hidden"></div>
  `;

  return resultsContainer;
}

/**
 * Shows a status message
 * @param {HTMLElement} container - Results container
 * @param {string} message - Status message
 * @param {string} type - Message type (loading, error, success)
 */
function showStatus(container, message, type = 'loading') {
  const statusEl = container.querySelector('.status-message');
  statusEl.className = `status-message ${type}`;

  if (type === 'loading') {
    statusEl.innerHTML = `<span class="spinner"></span>${message}`;
  } else {
    statusEl.textContent = message;
  }

  statusEl.classList.remove('hidden');
}

/**
 * Hides the status message
 * @param {HTMLElement} container - Results container
 */
function hideStatus(container) {
  const statusEl = container.querySelector('.status-message');
  statusEl.classList.add('hidden');
}

/**
 * Adds a generation event to the events log
 * @param {HTMLElement} container - Results container
 * @param {string} eventType - Type of event
 * @param {object} eventData - Event data
 */
function addGenerationEvent(container, eventType, eventData) {
  const eventsEl = container.querySelector('.generation-events');
  eventsEl.classList.remove('hidden');

  const eventItem = document.createElement('div');
  eventItem.className = 'event-item';

  // Format event data based on type
  let eventText = '';
  switch (eventType) {
    case 'intent':
      eventText = `<strong>Intent detected:</strong> ${eventData.intent || 'Processing...'}`;
      break;
    case 'classification':
      eventText = `<strong>Category:</strong> ${eventData.category || 'Classifying...'}`;
      break;
    case 'blocks':
      eventText = `<strong>Blocks selected:</strong> ${eventData.blocks?.join(', ') || 'Selecting...'}`;
      break;
    case 'content':
      eventText = `<strong>Content generated:</strong> ${eventData.blockType || 'Generating...'}`;
      break;
    case 'complete':
      eventText = `<strong>Generation complete</strong> - Page ready`;
      break;
    default:
      eventText = `<strong>${eventType}:</strong> ${JSON.stringify(eventData)}`;
  }

  eventItem.innerHTML = eventText;
  eventsEl.appendChild(eventItem);

  // Auto-scroll to latest event
  eventItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Displays the generated content directly on the page
 * @param {HTMLElement} block - The main block element
 * @param {string} html - Generated HTML content
 */
function displayGeneratedContent(block, html) {
  // Clear the block completely
  block.innerHTML = '';

  // Create a container for the generated content
  const contentContainer = document.createElement('div');
  contentContainer.className = 'generated-content';
  contentContainer.innerHTML = html;

  // Add a "New Search" button at the bottom
  const actionBar = document.createElement('div');
  actionBar.className = 'generated-content-actions';
  actionBar.innerHTML = `
    <button class="button" onclick="location.reload()">New Search</button>
  `;

  block.appendChild(contentContainer);
  block.appendChild(actionBar);
}

/**
 * Handles Server-Sent Events (SSE) from the generation API
 * @param {string} query - User query
 * @param {HTMLElement} resultsContainer - Results container element
 * @param {HTMLElement} block - The main block element
 */
async function handleGeneration(query, resultsContainer, block) {
  resultsContainer.classList.remove('hidden');

  // Clear previous results
  resultsContainer.querySelector('.generation-events').innerHTML = '';
  resultsContainer.querySelector('.content-preview').classList.add('hidden');

  showStatus(resultsContainer, 'Starting generation...', 'loading');

  // Variable to store the generated HTML
  let generatedHTML = '';

  try {
    // Build API URL with query parameter
    const apiUrl = new URL('/generate', API_BASE_URL);
    apiUrl.searchParams.set('q', query);

    // Create EventSource for SSE
    const eventSource = new EventSource(apiUrl.toString());

    eventSource.addEventListener('intent', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'intent', data);
      showStatus(resultsContainer, 'Analyzing your request...', 'loading');
    });

    eventSource.addEventListener('classification', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'classification', data);
      showStatus(resultsContainer, 'Determining content type...', 'loading');
    });

    eventSource.addEventListener('blocks', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'blocks', data);
      showStatus(resultsContainer, 'Generating content blocks...', 'loading');
    });

    eventSource.addEventListener('block', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'block', data);
      showStatus(resultsContainer, 'Building your page...', 'loading');
    });

    eventSource.addEventListener('content', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'content', data);
      showStatus(resultsContainer, 'Finalizing content...', 'loading');

      // Store the generated HTML
      generatedHTML = data.html || '';
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'complete', data);

      // Close the event source
      eventSource.close();

      // Hide loading status and display generated content
      hideStatus(resultsContainer);

      if (generatedHTML) {
        displayGeneratedContent(block, generatedHTML);
      } else {
        showStatus(resultsContainer, 'No content was generated', 'error');
      }
    });

    eventSource.addEventListener('error', (event) => {
      let errorMsg = 'Generation failed';
      try {
        const data = JSON.parse(event.data);
        errorMsg = data.message || errorMsg;
      } catch (e) {
        // Error parsing error message
      }

      showStatus(resultsContainer, errorMsg, 'error');
      eventSource.close();
    });

    eventSource.onerror = () => {
      showStatus(resultsContainer, 'Connection error. Please try again.', 'error');
      eventSource.close();
    };

  } catch (error) {
    showStatus(resultsContainer, `Error: ${error.message}`, 'error');
  }
}

/**
 * Decorates the generative search block
 * @param {HTMLElement} block - The block element
 */
export default async function decorate(block) {
  // Get optional title from block content BEFORE clearing
  const title = block.textContent.trim() || 'AI-Powered Content Generator';

  // Clear existing content
  block.innerHTML = '';

  // Create title
  const titleEl = document.createElement('h2');
  titleEl.textContent = title;

  // Create search interface
  const searchContainer = createSearchInterface(block);

  // Create results container
  const resultsContainer = createResultsContainer();

  // Assemble block
  block.appendChild(titleEl);
  block.appendChild(searchContainer);
  block.appendChild(resultsContainer);

  // Handle form submission
  const form = searchContainer.querySelector('.search-form');
  const input = searchContainer.querySelector('.search-input');
  const button = searchContainer.querySelector('.search-button');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const query = input.value.trim();
    if (!query) return;

    // Disable form during generation
    button.disabled = true;
    input.disabled = true;

    // Start generation (pass block element for content replacement)
    handleGeneration(query, resultsContainer, block).catch((error) => {
      console.error('Generation error:', error);
      // Re-enable form on error
      button.disabled = false;
      input.disabled = false;
    });
  });
}
