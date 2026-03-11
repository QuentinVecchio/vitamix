/**
 * Generative Search Block
 * Integrates with Cloudflare Worker API to generate dynamic content based on user queries
 * Uses the EDS block pipeline (buildBlock/decorateBlock/loadBlock) for real block rendering.
 */

import { buildBlock, decorateBlock, loadBlock } from '../../scripts/aem.js';

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
 * Displays generated content using real EDS blocks.
 * Each block is built, decorated, and loaded through the standard EDS pipeline
 * so existing block CSS/JS applies automatically.
 * @param {HTMLElement} block - The generative-search block element
 * @param {Array} generatedBlocks - Array of block definitions from the worker
 */
async function displayGeneratedContent(block, generatedBlocks) {
  const section = block.closest('.section');
  const main = section ? section.parentElement : block.closest('main');

  if (!main) {
    console.error('[generative-search] Cannot find <main> element');
    return;
  }

  // Build and insert each generated block as a proper EDS section.
  // We keep the search section visible until all blocks are rendered,
  // so errors remain visible to the user.
  const rendered = [];

  for (const genBlock of generatedBlocks) {
    try {
      const newSection = document.createElement('div');
      newSection.classList.add('section');
      newSection.dataset.sectionStatus = 'loaded';

      if (genBlock.type === 'default-content') {
        const wrapper = document.createElement('div');
        wrapper.classList.add('default-content-wrapper');
        wrapper.innerHTML = genBlock.content;
        newSection.appendChild(wrapper);
      } else {
        const blockEl = buildBlock(genBlock.type, genBlock.rows);
        const wrapper = document.createElement('div');
        wrapper.appendChild(blockEl);
        newSection.appendChild(wrapper);
        decorateBlock(blockEl);
        // eslint-disable-next-line no-await-in-loop
        await loadBlock(blockEl);
      }

      main.appendChild(newSection);
      rendered.push(newSection);
      console.log(`[generative-search] Rendered ${genBlock.type} block`);
    } catch (err) {
      console.error(`[generative-search] Failed to render ${genBlock.type}:`, err);
    }
  }

  // Add a "New Search" action section
  const actionSection = document.createElement('div');
  actionSection.classList.add('section');
  actionSection.dataset.sectionStatus = 'loaded';
  const actionWrapper = document.createElement('div');
  actionWrapper.classList.add('default-content-wrapper');
  actionWrapper.style.textAlign = 'center';
  actionWrapper.style.padding = 'var(--spacing-600) 0';
  const reloadLink = document.createElement('p');
  reloadLink.className = 'button-wrapper';
  reloadLink.innerHTML = '<a class="button secondary" href="#">New Search</a>';
  reloadLink.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });
  actionWrapper.appendChild(reloadLink);
  actionSection.appendChild(actionWrapper);
  main.appendChild(actionSection);
  rendered.push(actionSection);

  // Only hide the search section after blocks rendered successfully
  if (rendered.length > 0 && section) {
    section.style.display = 'none';
  }
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

  // Variable to store the generated blocks
  let generatedBlocks = [];

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
      showStatus(resultsContainer, 'Building page with real blocks...', 'loading');

      // Store the generated blocks
      generatedBlocks = data.blocks || [];
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'complete', data);

      // Close the event source
      eventSource.close();

      // Hide loading status and display generated content using EDS blocks
      hideStatus(resultsContainer);

      if (generatedBlocks.length > 0) {
        displayGeneratedContent(block, generatedBlocks).catch((error) => {
          console.error('Error rendering blocks:', error);
          showStatus(resultsContainer, 'Error displaying content', 'error');
        });
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
