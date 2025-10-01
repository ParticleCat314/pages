// Dictionary app with random word selection from JSON
class RandomDictionary {
    constructor() {
        this.words = [];
        this.isLoaded = false;
        this.wordIndex = new Map(); // For fast word lookups
        this.sortedWords = []; // Pre-sorted for binary search
        this.loadWords();
    }

    // Load and parse the JSON file
    async loadWords() {
        try {
            showLoading(true);
            const response = await fetch('words.json');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const jsonData = await response.json();
            this.parseJSON(jsonData);
            this.isLoaded = true;
            showLoading(false);
            console.log(`Loaded ${this.words.length} words from JSON`);
        } catch (error) {
            showError(`Error loading words file: ${error.message}`);
            showLoading(false);
        }
    }

    // Parse JSON data into array of objects
    parseJSON(jsonData) {
        // Handle different JSON formats
        if (Array.isArray(jsonData)) {
            // Format 1: Array of objects [{ "word": "...", "definition": "..." }, ...]
            this.words = jsonData.filter(entry => 
                entry && 
                typeof entry === 'object' && 
                entry.word && 
                entry.definition
            ).map(entry => ({
                word: entry.word.toString().trim(),
                definition: entry.definition.toString().trim()
            }));
        } else if (typeof jsonData === 'object' && jsonData !== null) {
            // Format 2: Object with word keys { "word1": "definition1", "word2": "definition2", ... }
            this.words = Object.entries(jsonData)
                .filter(([word, definition]) => word && definition)
                .map(([word, definition]) => ({
                    word: word.toString().trim(),
                    definition: definition.toString().trim()
                }));
        } else {
            throw new Error('Invalid JSON format. Expected array of objects or object with word-definition pairs.');
        }
        
        if (this.words.length === 0) {
            throw new Error('No valid word entries found in JSON file.');
        }
        
        // Build search indexes for performance
        this.buildSearchIndexes();
    }
    
    // Build indexes for faster searching
    buildSearchIndexes() {
        // Clear existing indexes
        this.wordIndex.clear();
        
        // Build word index for exact and prefix matches
        this.words.forEach((entry, index) => {
            const word = entry.word.toLowerCase();
            this.wordIndex.set(word, { entry, index });
        });
        
        // Create sorted array for binary search
        this.sortedWords = [...this.words].sort((a, b) => 
            a.word.toLowerCase().localeCompare(b.word.toLowerCase())
        );
        
        console.log(`Built search indexes for ${this.words.length} words`);
    }

    // Get a random word entry
    getRandomWord() {
        if (!this.isLoaded || this.words.length === 0) {
            return null;
        }
        
        const randomIndex = Math.floor(Math.random() * this.words.length);
        return this.words[randomIndex];
    }

    // Get multiple random words (unique)
    getMultipleRandomWords(count) {
        if (!this.isLoaded || this.words.length === 0) {
            return [];
        }
        
        const maxCount = Math.min(count, this.words.length);
        const selectedIndices = new Set();
        const result = [];
        
        while (selectedIndices.size < maxCount) {
            const randomIndex = Math.floor(Math.random() * this.words.length);
            if (!selectedIndices.has(randomIndex)) {
                selectedIndices.add(randomIndex);
                result.push(this.words[randomIndex]);
            }
        }
        
        return result;
    }
    _editDistance(s1, s2) {
        const dp = Array(s1.length + 1).fill(null).map(() => Array(s2.length + 1).fill(0));
        
        // Initialize base cases
        for (let i = 0; i <= s1.length; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= s2.length; j++) {
            dp[0][j] = j;
        }
        
        // Fill the DP table
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(
                        dp[i - 1][j],     // deletion
                        dp[i][j - 1],     // insertion
                        dp[i - 1][j - 1]  // substitution
                    );
                }
            }
        }
        
        return dp[s1.length][s2.length];
    }
    
    _fuzzyMatch(str, term) {
        const strLower = str.toLowerCase();
        const termLower = term.toLowerCase();
        
        // Exact match gets highest priority
        if (strLower === termLower) {
            return 100;
        }
        
        // Contains match gets high priority
        if (strLower.includes(termLower)) {
            return 80;
        }
        
        // For performance, skip expensive edit distance for very different lengths
        if (Math.abs(strLower.length - termLower.length) > termLower.length) {
            return 0;
        }
        
        // Check if all characters of term appear in order in str
        let termIndex = 0;
        for (let i = 0; i < strLower.length && termIndex < termLower.length; i++) {
            if (strLower[i] === termLower[termIndex]) {
                termIndex++;
            }
        }
        if (termIndex === termLower.length) {
            return 60; // Subsequence match
        }
        
        // Only use expensive edit distance for reasonable matches
        if (termLower.length <= 8) { // Limit edit distance to shorter terms
            const maxLength = Math.max(strLower.length, termLower.length);
            const editDist = this._editDistance(strLower, termLower);
            const similarity = Math.max(0, (maxLength - editDist) / maxLength * 100);
            return similarity > 40 ? similarity : 0;
        }
        
        return 0;
    }

    // Fast search using multiple optimization techniques
    searchWords(searchTerm) {
        if (!this.isLoaded || !searchTerm) {
            return [];
        }
        
        const termLower = searchTerm.toLowerCase();
        const results = [];
        const maxResults = 1000; // Limit results for performance
        
        // Strategy 1: Check for exact match first
        if (this.wordIndex.has(termLower)) {
            const exactMatch = this.wordIndex.get(termLower);
            results.push({
                ...exactMatch.entry,
                score: 100,
                matchType: 'word'
            });
        }
        
        // Strategy 2: Fast prefix and contains matches
        const fastMatches = [];
        const expensiveMatches = [];
        
        for (const entry of this.words) {
            // Skip if we already found this as exact match
            if (entry.word.toLowerCase() === termLower) {
                continue;
            }
            
            const wordLower = entry.word.toLowerCase();
            
            // Fast checks first
            if (wordLower.startsWith(termLower)) {
                fastMatches.push({ entry, score: 90, matchType: 'word' });
            } else if (wordLower.includes(termLower)) {
                fastMatches.push({ entry, score: 80, matchType: 'word' });
            } else if (searchTerm.length >= 3) {
                // Only do expensive fuzzy matching for longer terms
                expensiveMatches.push(entry);
            }
            
            // Early termination if we have enough fast matches
            if (fastMatches.length >= maxResults / 2) {
                break;
            }
        }
        
        // Add fast matches
        results.push(...fastMatches.map(match => ({
            ...match.entry,
            score: match.score,
            matchType: match.matchType
        })));
        
        // Only do expensive fuzzy matching if we need more results
        if (results.length < 50 && expensiveMatches.length > 0) {
            const fuzzyLimit = Math.min(expensiveMatches.length, 500); // Limit fuzzy search
            
            for (let i = 0; i < fuzzyLimit; i++) {
                const entry = expensiveMatches[i];
                const wordScore = this._fuzzyMatch(entry.word, searchTerm);
                
                if (wordScore > 0) {
                    results.push({
                        ...entry,
                        score: wordScore,
                        matchType: 'word'
                    });
                }
                
                // Stop if we have enough results
                if (results.length >= maxResults) {
                    break;
                }
            }
        }
        
        // Sort by score (highest first) and limit results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
    }
}

// Initialize the dictionary
const dictionary = new RandomDictionary();

// Search pagination state
let currentSearchResults = [];
let currentSearchTerm = '';
let displayedResultsCount = 0;
let searchDebounceTimer = null;
let isSearchMode = false;
let lastSearchTerm = '';
let cachedSearchResults = new Map(); // Cache recent searches
const RESULTS_PER_PAGE = 10;
const SEARCH_DEBOUNCE_DELAY = 0; // milliseconds
const CACHE_SIZE_LIMIT = 50;

// Create animated background
function createStarfield() {
    const starsContainer = document.getElementById('stars');
    const numStars = 80; // Reduced from 150
    
    for (let i = 0; i < numStars; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        
        // Smaller, more subtle stars
        const size = Math.random() * 2 + 0.5; // Reduced size
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        
        // Longer, more subtle animation delays
        star.style.animationDelay = Math.random() * 5 + 's';
        
        starsContainer.appendChild(star);
    }
}

function createFloatingParticles() {
    const particlesContainer = document.getElementById('particles');
    
    function addParticle() {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Smaller, more subtle particles
        const size = Math.random() * 2 + 1; // Reduced size
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.left = Math.random() * 100 + '%';
        
        // Slower, longer animations
        particle.style.animationDuration = (Math.random() * 15 + 15) + 's';
        particle.style.animationDelay = Math.random() * 3 + 's';
        
        particlesContainer.appendChild(particle);
        
        // Remove particle after animation
        setTimeout(() => {
            if (particle.parentNode) {
                particle.parentNode.removeChild(particle);
            }
        }, 33000);
    }
    
    // Add particles less frequently
    setInterval(addParticle, 2000); // Increased from 800ms
    
    // Fewer initial particles
    for (let i = 0; i < 3; i++) {
        setTimeout(addParticle, i * 500);
    }
}

// Initialize background animations when page loads
document.addEventListener('DOMContentLoaded', function() {
    createStarfield();
    createFloatingParticles();
    
    // Set up live search
    const searchInput = document.getElementById('searchInput');
    const searchStatus = document.getElementById('searchStatus');
    
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim();
        
        // Clear previous timer
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        
        if (query.length === 0) {
            clearSearch();
            return;
        }
        
        if (query.length < 2) {
            searchStatus.textContent = 'Type at least 2 characters to search...';
            return;
        }
        
        // Show searching indicator
        searchStatus.textContent = 'Searching...';
        
        // Debounce the search
        searchDebounceTimer = setTimeout(() => {
            performLiveSearch(query);
        }, SEARCH_DEBOUNCE_DELAY);
    });
    
    // Handle Enter key
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (searchDebounceTimer) {
                clearTimeout(searchDebounceTimer);
            }
            const query = e.target.value.trim();
            if (query.length >= 2) {
                performLiveSearch(query);
            }
        }
    });
});

function performLiveSearch(searchTerm) {
    const searchStatus = document.getElementById('searchStatus');
    
    if (!dictionary.isLoaded) {
        searchStatus.textContent = 'Dictionary is still loading...';
        return;
    }
    
    // Check cache first
    if (cachedSearchResults.has(searchTerm)) {
        const cachedResults = cachedSearchResults.get(searchTerm);
        displaySearchResults(cachedResults, searchTerm);
        searchStatus.textContent = '';
        return;
    }
    
    hideError();
    isSearchMode = true;
    lastSearchTerm = searchTerm;
    
    // Use requestAnimationFrame for better performance
    requestAnimationFrame(() => {
        const startTime = performance.now();
        const results = dictionary.searchWords(searchTerm);
        const endTime = performance.now();
        
        // Cache the results
        if (cachedSearchResults.size >= CACHE_SIZE_LIMIT) {
            // Remove oldest entry
            const firstKey = cachedSearchResults.keys().next().value;
            cachedSearchResults.delete(firstKey);
        }
        cachedSearchResults.set(searchTerm, results);
        
        if (results.length > 0) {
            displaySearchResults(results, searchTerm);
            searchStatus.textContent = `Found ${results.length} results in ${Math.round(endTime - startTime)}ms`;
        } else {
            searchStatus.textContent = `No results found for "${searchTerm}"`;
            document.getElementById('wordDisplay').innerHTML = '';
            currentSearchResults = [];
            currentSearchTerm = '';
            displayedResultsCount = 0;
        }
        
        // Clear timing display after 2 seconds
        setTimeout(() => {
            if (searchStatus.textContent.includes('ms')) {
                searchStatus.textContent = '';
            }
        }, 2000);
    });
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchStatus = document.getElementById('searchStatus');
    const wordDisplay = document.getElementById('wordDisplay');
    
    searchInput.value = '';
    searchStatus.textContent = '';
    wordDisplay.innerHTML = '';
    
    // Clear search state
    currentSearchResults = [];
    currentSearchTerm = '';
    displayedResultsCount = 0;
    isSearchMode = false;
    lastSearchTerm = '';
    
    // Clear cache periodically to free memory
    if (cachedSearchResults.size > 20) {
        cachedSearchResults.clear();
    }
    
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }
    
    hideError();
}

// UI Helper functions
function showLoading(show) {
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = show ? 'block' : 'none';
}

function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 5000);
}

function hideError() {
    const errorEl = document.getElementById('error');
    errorEl.style.display = 'none';
}

function displayWord(wordObj) {
    const displayEl = document.getElementById('wordDisplay');
    displayEl.innerHTML = `
        <div class="word">${wordObj.word}</div>
        <div class="definition">${wordObj.definition}</div>
    `;
}

function displayMultipleWords(wordArray) {
    const displayEl = document.getElementById('wordDisplay');
    let html = '';
    
    wordArray.forEach((wordObj, index) => {
        html += `
            <div class="word-entry random">
                <div class="word">${wordObj.word}</div>
                <div class="definition">${wordObj.definition}</div>
            </div>
        `;
    });
    
    displayEl.innerHTML = html;
}

function displaySearchResults(results, searchTerm, isLoadMore = false) {
    const displayEl = document.getElementById('wordDisplay');
    
    if (!isLoadMore) {
        // New search - reset display
        displayEl.innerHTML = '';
        displayedResultsCount = 0;
        currentSearchResults = results;
        currentSearchTerm = searchTerm;
    }
    
    // Calculate which results to show
    const startIndex = displayedResultsCount;
    const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, results.length);
    const resultsToShow = results.slice(startIndex, endIndex);
    
    // Create HTML for new results
    let html = '';
    resultsToShow.forEach((wordObj, index) => {
        const matchIndicator = wordObj.matchType === 'word' ? '📝' : '📚';
        const scoreBar = Math.round(wordObj.score / 10);
        const scoreDisplay = '●'.repeat(scoreBar) + '○'.repeat(10 - scoreBar);
        
        html += `
            <div class="word-entry">
                <div class="search-meta">
                    <span class="match-type">${matchIndicator} ${wordObj.matchType}</span>
                    <span class="relevance-score" title="Relevance: ${Math.round(wordObj.score)}%">${scoreDisplay}</span>
                </div>
                <div class="word">${highlightMatch(wordObj.word, searchTerm)}</div>
                <div class="definition">${highlightMatch(wordObj.definition, searchTerm)}</div>
            </div>
        `;
    });
    
    // Append or set HTML
    if (isLoadMore) {
        // Remove existing load more button if present
        const existingButton = displayEl.querySelector('.load-more-container');
        if (existingButton) {
            existingButton.remove();
        }
        displayEl.insertAdjacentHTML('beforeend', html);
    } else {
        displayEl.innerHTML = html;
    }
    
    // Update displayed count
    displayedResultsCount = endIndex;
    
    // Add load more button if there are more results
    if (displayedResultsCount < results.length) {
        const remainingCount = results.length - displayedResultsCount;
        const loadMoreHtml = `
            <div class="load-more-container">
                <button class="load-more-btn" onclick="loadMoreResults()">
                    Load ${Math.min(RESULTS_PER_PAGE, remainingCount)} more results 
                    (${remainingCount} remaining)
                </button>
            </div>
        `;
        displayEl.insertAdjacentHTML('beforeend', loadMoreHtml);
    }
    
    // Show result summary
    if (!isLoadMore) {
        const summaryMsg = `Showing ${displayedResultsCount} of ${results.length} results for "${searchTerm}"`;
        showError(summaryMsg);
    }
}

function highlightMatch(text, searchTerm) {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

function loadMoreResults() {
    if (currentSearchResults.length > 0) {
        displaySearchResults(currentSearchResults, currentSearchTerm, true);
    }
}

// Main functions called by buttons
function getRandomWord() {
    // Clear search mode when getting random word
    if (isSearchMode) {
        clearSearch();
    }
    
    hideError();
    
    if (!dictionary.isLoaded) {
        showError('Dictionary is still loading. Please wait a moment.');
        return;
    }
    
    const randomWord = dictionary.getRandomWord();
    if (randomWord) {
        displayWord(randomWord);
    } else {
        showError('No words available.');
    }
}

function getMultipleWords(count = 5) {
    // Clear search mode when getting random words
    if (isSearchMode) {
        clearSearch();
    }
    
    hideError();
    
    if (!dictionary.isLoaded) {
        showError('Dictionary is still loading. Please wait a moment.');
        return;
    }
    
    const randomWords = dictionary.getMultipleRandomWords(count);
    if (randomWords.length > 0) {
        displayMultipleWords(randomWords);
    } else {
        showError('No words available.');
    }
}

// Add keyboard shortcuts
document.addEventListener('keydown', function(event) {
    // Don't interfere if user is typing in search box
    if (document.activeElement.id === 'searchInput') {
        return;
    }
    
    // Press 'R' or Space for random word
    if (event.key === 'r' || event.key === 'R' || event.key === ' ') {
        event.preventDefault();
        getRandomWord();
    }
    // Press '5' for 5 random words
    else if (event.key === '5') {
        event.preventDefault();
        getMultipleWords(5);
    }
    // Press '/' to focus search
    else if (event.key === '/') {
        event.preventDefault();
        document.getElementById('searchInput').focus();
    }
    // Press Escape to clear search
    else if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch();
        document.getElementById('searchInput').blur();
    }
});
