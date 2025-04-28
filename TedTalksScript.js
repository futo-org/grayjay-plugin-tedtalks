/**
 * TED Talks Plugin for Grayjay
 * 
 * This plugin enables browsing, searching, and viewing TED Talk videos.
 * It interfaces with TED's GraphQL API and web interface to provide content.
 */

// ---------------------- Constants ----------------------
const PLATFORM = {
    NAME: 'TEDTalks',
    BASE_URL: 'https://www.ted.com',
    TALKS_URL: 'https://www.ted.com/talks',
    GRAPHQL_URL: 'https://www.ted.com/graphql',
    SEARCH_URL: 'https://zenith-prod-alt.ted.com/api/search',
    SPEAKER_URL: 'https://www.ted.com/speakers',
    FALLBACK_AVATAR: 'https://plugins.grayjay.app/TedTalks/media/speaker.png'
};

// Regular expressions for URL matching
const REGEX = {
    SPEAKER_URL: /^https?:\/\/(www\.)?ted\.com\/speakers\/[^\/\s]+(\?.*)?$/i,
    TALK_URL: /^https?:\/\/(www\.)?ted\.com\/talks\/[^\/\s]+(\?.*)?$/i,
    SPEAKER_SLUG: /ted\.com\/speakers\/([a-zA-Z0-9_-]+)(?:\?|$)/,
    SPEAKER_ID: /speakerId=(\d+)/,
    TALK_SLUG: /ted\.com\/talks\/([^?#]+)/i,
    HLS_URL: /https:\/\/.*\.m3u8/i,
    MPEG_URL: /https:\/\/.*\.mp4/i
};

// Default request headers for TED API
const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    Origin: PLATFORM.BASE_URL,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0'
};

// Video quality settings
const VIDEO_QUALITY = {
    LOW: {
        width: 320,
        height: 180,
        name: 'Low - video/mp4'
    },
    MEDIUM: {
        width: 854,
        height: 480,
        name: 'Medium - video/mp4'
    },
    HIGH: {
        width: 1920,
        height: 1080,
        name: 'High - video/mp4'
    }
};

// Plugin configuration storage
let config = {};

// ====================== PLUGIN ENTRY POINTS ======================

/**
 * Initialize the plugin with configuration
 */
source.enable = (conf, settings, saveStateStr) => {
    config = conf;
};

/**
 * Get home page content
 * @returns {ContentPager} Paged results for home page
 */
source.getHome = () => {
    return new TedTalksHomePager();
};

/**
 * Search for TED Talks
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
source.search = (query) => {
    return new TedTalksSearchPager(query);
};

/**
 * Search for TED Speakers
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
source.searchChannels = (query) => {
    return searchSpeakers(query);
};

/**
 * Check if a URL is a TED speaker channel
 * @param {string} url URL to check
 * @returns {boolean} True if the URL is a TED speaker channel
 */
source.isChannelUrl = (url) => {
    return urlMatches(url, REGEX.SPEAKER_URL);
};

/**
 * Get content from a TED speaker channel
 * @param {string} url Speaker channel URL
 * @returns {ContentPager} Paged results for channel content
 */
source.getChannelContents = (url) => {
    return getChannelContentsByUrl(url);
};

/**
 * Get content from a TED speaker channel
 * @param {string} url Speaker channel URL
 * @returns {ContentPager} Paged results for channel content
 */
source.getChannel = (url) => {
    return getChannelByUrl(url);
};

/**
 * Check if a URL is a TED Talk content page
 * @param {string} url URL to check
 * @returns {boolean} True if the URL is a TED Talk content page
 */
source.isContentDetailsUrl = (url) => {
    return urlMatches(url, REGEX.TALK_URL);
};

/**
 * Get detailed content information for a TED Talk
 * @param {string} url TED Talk URL
 * @returns {PlatformVideoDetails} Video details
 */
source.getContentDetails = (url) => {
    return getVideoDetailsByUrl(url);
};

/**
 * Get recommended content based on a TED Talk
 * @param {string} url TED Talk URL
 * @returns {ContentPager} Paged results with recommended content
 */
source.getContentRecommendations = (url, relatedVideos) => {
    return getVideoRecommendations(url, relatedVideos);
};

// ====================== CUSTOM PAGER IMPLEMENTATIONS ======================
/**
 * Custom pager implementation for TED Talks home page
 */
class TedTalksHomePager extends ContentPager {
    /**
     * Creates a new TED Talks home pager
     */
    constructor() {
        super([], true);
        this.cursor = "0";
        this.hasNextPage = true;
        this.nextPage();
    }

    /**
     * Fetches the next page of results
     * @returns {ContentPager} Pager with the current page results
     */
    nextPage() {
        try {
            const queryInfo = {
                query: GQL_QUERIES.HOME_VIDEOS,
                variables: {
                    first: 20,
                    after: this.cursor,
                    isPublished: true
                }
            };

            const response = makeRequestWithRetry('POST', PLATFORM.GRAPHQL_URL, JSON.stringify(queryInfo), DEFAULT_HEADERS, { parseResponse: true });

            if (!response.isOk) {
                logError(`GraphQL request failed for home videos. Status: ${response.status}`);
                showToast(`Failed to load TED Talks. Please try again later.`);
                return createEmptyPager();
            }

            const responseData = safeJsonParse(response.body);
            if (!responseData?.data?.videos?.nodes) {
                logError('Invalid response format for home videos');
                return createEmptyPager();
            }

            // Extract video data
            const videos = responseData.data.videos.nodes.map(video => convertToVideo(video, {}));

            // Update pagination info
            this.hasNextPage = responseData.data.videos.pageInfo.hasNextPage;
            this.cursor = responseData.data.videos.pageInfo.endCursor;

            // Update results
            this.results = videos;
            this.hasMore = this.hasNextPage;

            return this;
        } catch (error) {
            logError(`Exception in TedTalksHomePager.nextPage: ${error.message}`);
            showToast(`Failed to load TED Talks: ${error.message}`);
            return createEmptyPager();
        }
    }
}

/**
 * Custom pager implementation for TED Talks search results
 */
class TedTalksSearchPager extends ContentPager {
    /**
     * Creates a new TED Talks search pager
     * @param {string} query Search query
     */
    constructor(query) {
        super([], true);
        this.query = query;
        this.currentPage = 0;
        this.hitsPerPage = 24;
        this.nextPage();
    }

    /**
     * Fetches the next page of results
     * @returns {ContentPager} Pager with the current page results
     */
    nextPage() {
        try {
            const searchParams = {
                "attributeForDistinct": "objectID",
                "distinct": 1,
                "facets": ["subtitle_languages", "tags"],
                "highlightPostTag": "__/ais-highlight__",
                "highlightPreTag": "__ais-highlight__",
                "hitsPerPage": this.hitsPerPage,
                "maxValuesPerFacet": 500,
                "page": this.currentPage,
                "query": this.query
            };

            const request = [{ "indexName": "newest", "params": searchParams }];
            const response = makeRequestWithRetry('POST', PLATFORM.SEARCH_URL, JSON.stringify(request), DEFAULT_HEADERS, { parseResponse: true });

            if (!response.isOk) {
                logError(`Search API request failed. Status: ${response.status}, Query: "${this.query}", Page: ${this.currentPage}`);
                showToast(`Failed to load TED Talks. Please try again later.`);
                return createEmptyPager();
            }

            const searchResults = safeJsonParse(response.body)?.results?.[0];
            if (!searchResults?.hits) {
                logError(`Invalid search response format for query: "${this.query}", Page: ${this.currentPage}`);
                return createEmptyPager();
            }

            const hits = searchResults.hits;
            if (hits.length === 0) {
                return createEmptyPager();
            }

            // Get additional metadata for the videos
            const slugs = hits.map(hit => hit.slug).filter(Boolean);

            const extraMetadata = getVideoDetailsBySlugList(slugs) || {};
            // Convert hits to videos
            const videos = hits.map(hit => convertToVideo(hit, extraMetadata[hit.slug] || {}));

            // Calculate if there are more pages
            const totalHits = searchResults.nbHits || 0;
            const totalPages = Math.ceil(totalHits / this.hitsPerPage);
            const hasNextPage = this.currentPage < totalPages - 1;

            // Increment the page for next time
            this.currentPage++;

            // Update results and hasMore
            this.results = videos;
            this.hasMore = hasNextPage;

            // Return self
            return this;
        } catch (error) {
            logError(`Exception in TedTalksSearchPager.nextPage: ${error.message}`);
            showToast(`Failed to load TED Talks: ${error.message}`);
            return createEmptyPager();
        }
    }
}

// ====================== CORE FUNCTIONALITY ======================

/**
 * Search for TED speakers
 * @param {string} query Search query
 * @returns {ContentPager} Paged results for search
 */
function searchSpeakers(query) {
    const url = `${PLATFORM.SPEAKER_URL}?sort=first&q=${encodeURIComponent(query)}`;
    const response = makeRequestWithRetry('GET', url, null, { 'User-Agent': DEFAULT_HEADERS["User-Agent"] }, { parseResponse: true });

    if (!response.isOk) {
        logError(`Failed to get speakers search page. Status: ${response.status}, URL: ${url}`);
        showToast('Failed to load speaker search results.');
        return createEmptyPager();
    }

    try {
        const speakerElements = domParser
            .parseFromString(response.body, 'text/html')
            .querySelectorAll('div#browse-results .col');

        const channels = Array.from(speakerElements).map(element => {
            const name = element.querySelector('div.media__message h4')?.text;
            const photoUrl = element.querySelector('img.thumb__image')?.getAttribute('src');
            const profileRelativeUrl = element.querySelector('a.results__result')?.getAttribute('href');
            const profileUrl = profileRelativeUrl ? `${PLATFORM.BASE_URL}${profileRelativeUrl}` : '';
            const speakerSlug = profileUrl ? extractSpeakerSlug(profileUrl) : '';
            const speakerId = speakerSlug || name;

            return new PlatformChannel({
                id: new PlatformID(PLATFORM.NAME, speakerId, config.id),
                name: name,
                thumbnail: photoUrl ?? '',
                subscribers: -1,
                url: profileUrl
            });
        });

        return new ContentPager(channels, false);
    } catch (error) {
        logError(`Exception in searchSpeakers: ${error.message}`);
        return createEmptyPager();
    }
}

/**
 * Gets recommended videos for a TED Talk
 * @param {string} url TED Talk URL
 * @param {Array} relatedVideos Optional array of related videos
 * @returns {ContentPager} Paged results with recommended content
 */
function getVideoRecommendations(url, relatedVideos) {
    try {
        const slug = extractTedSlug(url);
        if (!slug) {
            logError(`Could not extract TED talk slug from URL: ${url}`);
            return createEmptyPager();
        }

        // If related videos aren't provided, fetch them
        if (!relatedVideos) {
            const responseBody = makeGraphQLRequest(
                'RELATED',
                { slug: slug, language: "en" },
                "related"
            );
            
            if (!responseBody?.data?.videos?.nodes || responseBody.data.videos.nodes.length === 0) {
                logError(`No video data found for slug: ${slug}`);
                return createEmptyPager();
            }
            
            relatedVideos = responseBody?.data?.videos?.nodes?.[0]?.relatedVideos ?? [];
            
        }

        if (!relatedVideos?.length) {
            return createEmptyPager();
        }

        // Get additional metadata for the videos
        const slugs = relatedVideos.map(video => video.slug);
        const metaSet = getVideoDetailsBySlugList(slugs);

        // Convert related videos to platform videos
        const videos = relatedVideos.map(relatedVideo => {
            return convertToVideo(relatedVideo, metaSet[relatedVideo.slug])
        });

        return new ContentPager(videos, false);
    } catch (error) {
        logError(`Exception in getVideoRecommendations: ${error.message}`);
        return createEmptyPager();
    }
}

/**
 * Gets channel content from a TED speaker URL
 * @param {string} url Speaker URL
 * @returns {ContentPager} Paged results for channel content
 */
function getChannelContentsByUrl(url) {
    try {
        const channelSlug = extractSpeakerSlug(url);
        if (!channelSlug) {
            showToast('Could not determine speaker from URL.');
            return createEmptyPager();
        }

        // Fetch the speaker page
        const response = makeRequestWithRetry('GET', url, null, { 'User-Agent': DEFAULT_HEADERS["User-Agent"] });
        if (!response.isOk) {
            logError(`Failed to get channel page. Status: ${response.status}, URL: ${url}`);
            showToast('Failed to load speaker page or speaker does not have a profile yet.');
            return createEmptyPager();
        }

        // Extract talk slugs from the page
        const talkSlugs = extractTalkSlugsFromHtml(response.body);
        if (!talkSlugs || talkSlugs.length === 0) {
            showToast('Speaker does not have any talks yet.');
            return createEmptyPager();
        }

        // Fetch metadata for the talks
        const extraMetadata = getVideoDetailsBySlugList(talkSlugs);
        if (!extraMetadata) {
            return createEmptyPager();
        }

        // Process videos and sort by date
        const videos = Object.values(extraMetadata)
            .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
            .map(video => {
                // Filter speakers to only show the current channel speaker
                if (video?.speakers) {
                    video.speakers = video.speakers.filter(s => s.slug === channelSlug);
                }
                return convertToVideo(video, {});
            });

        return new ContentPager(videos, false);
    } catch (error) {
        logError(`Exception in getChannelContentsByUrl: ${error.message}`);
        showToast('Failed to load speaker content.');
        return createEmptyPager();
    }
}

/**
 * Gets channel information for a TED speaker
 * @param {string} url Speaker URL
 * @returns {PlatformChannel|null} Channel information or null on error
 */
function getChannelByUrl(url) {
    try {
        const speakerId = extractSpeakerId(url);

        // Try to get channel info using GraphQL API
        if (speakerId) {
            return getChannelByGraphQL(speakerId, url);
        }

        // Fallback to extracting info from the page
        return getChannelByHTML(url);
    } catch (error) {
        logError(`Exception in getChannelByUrl: ${error.message}`);
        return null;
    }
}

/**
 * Gets channel information using GraphQL API
 * @param {string} speakerId Speaker ID
 * @param {string} url Speaker URL
 * @returns {PlatformChannel|null} Channel information or null on error
 */
function getChannelByGraphQL(speakerId, url) {
    const responseBody = makeGraphQLRequest(
        'SPEAKER_BY_ID',
        { id: speakerId },
        "acmeSpeaker"
    );

    const speaker = responseBody?.data?.acmeSpeaker;
    if (!speaker) {
        logError(`Speaker data not found in response for ID: ${speakerId}`);
        return null;
    }

    const description = formatSpeakerDescription(speaker);
    const name = formatName(speaker.firstname, speaker.lastname);
    const channelId = speaker.slug || name || '';

    return new PlatformChannel({
        id: new PlatformID(PLATFORM.NAME, channelId, config.id),
        name: name,
        thumbnail: speaker.photoUrl || PLATFORM.FALLBACK_AVATAR,
        description: description,
        url: url,
    });
}

/**
 * Gets channel information by parsing HTML
 * @param {string} url Speaker URL
 * @returns {PlatformChannel|null} Channel information or null on error
 */
function getChannelByHTML(url) {
    logError(`Could not extract speaker ID from URL: ${url}. Extracting info from page`);

    const response = makeRequestWithRetry('GET', url, null, { 'User-Agent': DEFAULT_HEADERS["User-Agent"] });
    if (!response.isOk) {
        logError(`Failed to get channel page. Status: ${response.status}, URL: ${url}`);
        showToast('Speaker profile not found. This TED speaker may not have a public profile yet.');
        throw new UnavailableException("Not able to access speaker page.");
    }

    try {
        const doc = domParser.parseFromString(response.body, 'text/html');
        const mainElement = doc.querySelector('div.main');

        const name = mainElement.querySelector('.profile-header__name')?.text;
        const photoUrl = mainElement.querySelector('img.thumb__image')?.getAttribute('src');

        let description = mainElement.querySelector('.profile-intro')?.innerHTML ?? '';
        description += mainElement.querySelector('div.section')?.innerHTML ?? '';

        const speakerSlug = extractSpeakerSlug(url);
        const speakerId = speakerSlug || name || '';

        return new PlatformChannel({
            id: new PlatformID(PLATFORM.NAME, speakerId, config.id),
            name: name,
            thumbnail: photoUrl ?? '',
            description: description,
            url: url
        });
    } catch (error) {
        logError(`Exception parsing HTML for channel: ${error.message}`);
        return null;
    }
}

/**
 * Gets detailed video information for a TED Talk
 * @param {string} url TED Talk URL
 * @returns {PlatformVideoDetails|null} Video details or null on error
 */
function getVideoDetailsByUrl(url) {
    try {
        const slug = extractTedSlug(url);
        if (!slug) {
            logError(`Could not extract TED talk slug from URL: ${url}`);
            return null;
        }

        const responseBody = makeGraphQLRequest(
            'VIDEO_DETAILS',
            { slug: slug, language: "en" },
            "shareLinks"
        );

        if (!responseBody?.data?.videos?.nodes || responseBody.data.videos.nodes.length === 0) {
            logError(`No video data found for slug: ${slug}`);
            return null;
        }

        const video = responseBody.data.videos.nodes[0];
        const speaker = video.speakers?.nodes?.[0];
        const thumbnailUrl = extractThumbnailUrl(video);

        const details = new PlatformVideoDetails({
            id: new PlatformID(PLATFORM.NAME, video.canonicalUrl || slug, config.id),
            name: video.title || 'Unknown TED Talk',
            author: speaker ? createAuthorLink(speaker) : null,
            datetime: dateToUnixSeconds(video.publishedAt),
            description: video.description || '',
            url: url,
            video: createVideoSources(video),
            duration: safeParseInt(video.duration),
            thumbnails: new Thumbnails(thumbnailUrl ? [new Thumbnail(thumbnailUrl, 0)] : []),
            viewCount: video.viewedCount || 0,
        });

        // Add method to get recommendations without refetching video data
        details.getContentRecommendations = () => {
            return source.getContentRecommendations(url, video.relatedVideos);
        };

        return details;
    } catch (error) {
        logError(`Exception in getVideoDetailsByUrl: ${error.message}`);
        return null;
    }
}

// ====================== DATA FETCHING ======================

/**
 * Makes a GraphQL request to TED's API
 * @param {string} queryName Name of the query from GQL_QUERIES
 * @param {Object} variables Variables for the GraphQL query
 * @param {string} operationName Operation name for the GraphQL request
 * @returns {Object|null} Response body or null on error
 */
function makeGraphQLRequest(queryName, variables, operationName) {
    try {
        if (!GQL_QUERIES[queryName]) {
            logError(`Unknown GraphQL query: ${queryName}`);
            return null;
        }

        const queryInfo = {
            query: GQL_QUERIES[queryName],
            operationName: operationName,
            variables: variables
        };

        const response = makeRequestWithRetry('POST', PLATFORM.GRAPHQL_URL, JSON.stringify(queryInfo), DEFAULT_HEADERS, { parseResponse: true });

        if (!response.isOk) {
            logError(`GraphQL request failed. Query: ${queryName}, Status: ${response.status}`);
            return null;
        }

        return safeJsonParse(response.body);
    } catch (error) {
        logError(`Exception in makeGraphQLRequest: ${error.message}`);
        return null;
    }
}

/**
 * Fetches video details by slug from TED's GraphQL API
 * @param {Array<string>} slugs Array of video slugs to fetch
 * @returns {Object|null} Processed video data or null on error
 */
function getVideoDetailsBySlugList(slugs) {
    try {
        if (!slugs || !slugs.length) {
            return null;
        }

        const responseBody = makeGraphQLRequest(
            'VIDEOS_INFO_BY_SLUG',
            { slug: slugs },
            "videosInfo"
        );

        if (!responseBody?.data?.videos?.nodes) {
            return null;
        }

        // Process the response into a lookup table by slug
        return responseBody.data.videos.nodes.reduce((result, video) => {
            if (video.slug) {
                const speakers = video.speakers?.nodes || [];
                video.speakers = speakers;
                video.speaker = speakers[0] || null;
                result[video.slug] = video;
            }
            return result;
        }, {});
    } catch (error) {
        logError(`Exception in getVideoDetailsBySlugList: ${error.message}`);
        return null;
    }
}

/**
 * Makes an HTTP request with automatic retries and error handling
 * 
 * @param {string} method - HTTP method ('GET', 'POST', etc.)
 * @param {string} url - The URL to make the request to
 * @param {string|Object|null} body - Request body for POST/PUT requests
 * @param {Object} headers - HTTP headers for the request
 * @param {Object} options - Additional options
 * @param {boolean} [options.useAuth=false] - Whether to use authentication for the request
 * @param {boolean} [options.parseResponse=false] - Whether to parse the response as JSON
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {boolean} [options.throwOnError=false] - Whether to throw an exception on error
 * @returns {Object} - Response object with isOk, code, and body properties
 */
function makeRequestWithRetry(method, url, body = null, headers = {}, options = {}) {
    const {
        useAuth = false,
        parseResponse = false,
        maxRetries = 4,
        throwOnError = true
    } = options;
    
    let remainingAttempts = maxRetries + 1; // +1 for the initial attempt
    let lastResponse = null;
    let lastError = null;
    
    while (remainingAttempts > 0) {

        try {
            let response;
            
            // Make the appropriate type of request based on method
            if (method.toUpperCase() === 'GET') {
                // using object spread due to issue on desktop when modifying the object with response.parsedBody
                response = {...http.GET(url, headers, useAuth)};
            } else if (method.toUpperCase() === 'POST') {
                // using object spread due to issue on desktop when modifying the object with response.parsedBody
                response = {...http.POST(url, body, headers, useAuth)};
            } else {
                throw new ScriptException(`Unsupported HTTP method: ${method}`);
            }
            
            // If request was successful, optionally parse the response
            if (response.isOk && parseResponse) {
                try {
                    
                    response.parsedBody = JSON.parse(response.body);
                    
                    // Check for API error responses that might be in a 200 response
                    if (response.parsedBody.errors) {
                        const errorMsg = `API returned error: ${JSON.stringify(response.parsedBody.errors)}`;
                        logError(errorMsg);
                        if (throwOnError) {
                            throw new ScriptException(errorMsg);
                        }
                    }
                } catch (parseError) {
                    
                    const errorMsg = `Failed to parse response as JSON: ${parseError.message}`;
                    logError(errorMsg);
                    if (throwOnError) {
                        throw new ScriptException(errorMsg);
                    }
                }
            }
            
            // Return on success
            if (response.isOk) {
                return response;
            }
            
            // Save the failed response and log the error
            lastResponse = response;
            const errorMsg = `${method} request to ${url} failed with status ${response.code}`;
            logError(`${errorMsg}. Attempts left: ${remainingAttempts - 1}`);
            
            if (throwOnError) {
                throw new ScriptException(errorMsg);
            }
            
            remainingAttempts--;
            
        } catch (error) {
            // Save the error and log it
            lastError = error;
            logError(`Exception in ${method} request to ${url}: ${error.message}. Attempts left: ${remainingAttempts - 1}`);
            
            if (throwOnError && remainingAttempts <= 1) {
                throw error;
            }
            
            remainingAttempts--;
        }
    }
    
    // All retry attempts have failed, return last response or construct a dummy response
    if (lastResponse) {
        return lastResponse;
    }
    
    // Create a dummy response if we don't have a real one
    return { 
        isOk: false, 
        code: 0,
        status: 0,
        body: JSON.stringify({ error: lastError ? lastError.message : `${method} request failed after all retry attempts` }) 
    };
}

// ====================== CONVERSION FUNCTIONS ======================

function mapSource(source, key, duration) {
    let sources = [];
    if (REGEX.HLS_URL.test(source.stream)) {
        sources.push(
            new HLSSource({
                name: key,
                url: source.stream,
                duration: duration
            }),
        );
    } else if (REGEX.MPEG_URL.test(source.file)) {
        sources.push(
            new VideoUrlSource({
                name: key,
                duration: duration,
                url: source.file,
                container: "video/mp4"
            }),
        );
    }

    return sources;
}
/**
 * Converts TED Talk video data to platform-specific video format
 * @param {Object} videoData TED Talk video data
 * @param {Object} extraData Extra metadata for the video
 * @returns {PlatformVideo} Formatted platform video object
 */
function convertToVideo(videoData, extraData) {
    try {
        const videoUrl = `${PLATFORM.TALKS_URL}/${videoData.slug || ''}`;

        // Get speaker information, with fallbacks
        const speaker = extractSpeakerInfo(videoData, extraData);

        const viewedCount = videoData?.viewedCount || extraData?.viewedCount || 0;
        const publishedAt = videoData?.publishedAt || extraData?.publishedAt || null;
        const duration = safeParseInt(videoData.duration);

        // Create author link
        const author = createAuthorLink({
            id: speaker.id,
            firstname: speaker.firstname,
            lastname: speaker.lastname,
            slug: speaker.slug,
            photoUrl: speaker.photoUrl
        });
        // Extract thumbnails
        const thumbnails = extractThumbnails(videoData, extraData);


        const details = new PlatformVideoDetails({
            id: new PlatformID(PLATFORM.NAME, videoData.slug || 'unknown', config.id),
            name: videoData.title || 'Unknown TED Talk',
            thumbnails: new Thumbnails(thumbnails),
            description: videoData.description || '',
            duration: duration,
            viewCount: viewedCount,
            url: videoUrl,
            uploadDate: dateToUnixSeconds(publishedAt),
            shareUrl: videoUrl,
            author: author,
            video: createVideoSources(videoData)
        });

        details.getContentRecommendations = () => {
            return source.getContentRecommendations(videoUrl, videoData.relatedVideos);
        };

        return details;
    } catch (error) {
        logError(`Exception in convertToVideo: ${error.message}`);

        // Return a minimal valid video object with available data
        return createFallbackVideo(videoData);
    }
}

/**
 * Extracts speaker information from video data
 * @param {Object} videoData Video data
 * @param {Object} extraData Additional metadata
 * @returns {Object} Speaker information with firstname, lastname, slug, id, and photoUrl
 */
function extractSpeakerInfo(videoData, extraData) {

    // Find the first available speaker source
    const speakerSource = [
        videoData.speakers?.nodes?.[0],
        videoData.speakers?.[0],
        extraData?.speaker
    ].find(source => source);
    
    // If a speaker source was found, extract information from it
    if (speakerSource) {
        return {
            firstname: speakerSource.firstname || '',
            lastname: speakerSource.lastname || '',
            slug: speakerSource.slug || '',
            id: speakerSource.id || '',
            photoUrl: speakerSource.photoUrl || PLATFORM.FALLBACK_AVATAR
        };
    }
    
    // Return a default speaker object if no information was found
    return {
        firstname: 'Unknown Speaker',
        lastname: '',
        slug: '',
        id: '',
        photoUrl: PLATFORM.FALLBACK_AVATAR
    };
}

/**
 * Extracts thumbnails from video data
 * @param {Object} videoData Video data
 * @param {Object} extraData Additional metadata
 * @returns {Array} Array of Thumbnail objects
 */
function extractThumbnails(videoData, extraData) {
    // Try to get thumbnails from photo_sizes
    let thumbnails = (videoData?.photos?.[0]?.photo_sizes || []).map(size => {
        return new Thumbnail(size.url, safeParseInt(size.height));
    });

    // Try to add a thumbnail from playerData if none found
    if (thumbnails.length === 0) {
        const thumbUrl = extractThumbnailUrl(videoData) || extractThumbnailUrl(extraData);
        if (thumbUrl) {
            thumbnails.push(new Thumbnail(thumbUrl, 0));
        }
    }

    return thumbnails;
}

/**
 * Creates a fallback video object with minimal data
 * @param {Object} videoData Basic video data
 * @returns {PlatformVideo} Minimal video object
 */
function createFallbackVideo(videoData) {
    return new PlatformVideo({
        id: new PlatformID(PLATFORM.NAME, videoData.slug || "unknown", config.id),
        name: videoData.title || "Unknown TED Talk",
        thumbnails: new Thumbnails([]),
        duration: 0,
        url: `${PLATFORM.TALKS_URL}/${videoData.slug || ""}`,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM.NAME, "unknown", config.id),
            "Unknown Speaker",
            "",
            PLATFORM.FALLBACK_AVATAR
        )
    });
}

/**
 * Creates a PlatformAuthorLink for a speaker
 * @param {Object} speaker Speaker data
 * @returns {PlatformAuthorLink} Author link object
 */
function createAuthorLink(speaker) {
    if (!speaker) return null;

    return new PlatformAuthorLink(
        new PlatformID(
            PLATFORM.NAME,
            speaker.id || '',
            config.id
        ),
        formatName(speaker.firstname, speaker.lastname),
        `${PLATFORM.SPEAKER_URL}/${speaker.slug || ''}${speaker.id ? `?speakerId=${speaker.id}` : ''}`,
        speaker.photoUrl || PLATFORM.FALLBACK_AVATAR
    );
}

/**
 * Creates video source objects for a video
 * @param {Object} video Video data
 * @returns {Array} Array of video source objects
 */
function createVideoSources(video) {
    const videoSources = [];
    
    const duration = safeParseInt(video.duration);

    // Add HLS source if available
    if (video.hlsUrl) {
        videoSources.push(
            new HLSSource({
                name: 'HLS',
                url: video.hlsUrl,
                duration: duration
            })
        );
    }

    // Add MP4 sources for different qualities
    if (video?.nativeDownloads?.low) {
        videoSources.push(
            new VideoUrlSource({
                name: VIDEO_QUALITY.LOW.name,
                duration: duration,
                url: video?.nativeDownloads?.low,
                width: VIDEO_QUALITY.LOW.width,
                height: VIDEO_QUALITY.LOW.height,
                container: "video/mp4"
            })
        );
    }

    // Medium quality
    if (video?.nativeDownloads?.medium) {
        videoSources.push(
            new VideoUrlSource({
                name: VIDEO_QUALITY.MEDIUM.name,
                duration: duration,
                url: video?.nativeDownloads?.medium,
                width: VIDEO_QUALITY.MEDIUM.width,
                height: VIDEO_QUALITY.MEDIUM.height,
                container: "video/mp4"
            })
        );
    }

    // High quality
    if (video?.nativeDownloads?.high) {
        videoSources.push(
            new VideoUrlSource({
                name: VIDEO_QUALITY.HIGH.name,
                duration: duration,
                url: video?.nativeDownloads?.medium,
                width: VIDEO_QUALITY.HIGH.width,
                height: VIDEO_QUALITY.HIGH.height,
                container: "video/mp4"
            })
        );
    }

    const playerData = video?.playerData;

    if (!videoSources.length && playerData) {

        try {
            const playerData = safeJsonParse(playerData);
            if (playerData?.resources) {
                for (let key in playerData.resources) {
                    const sourceType = playerData.resources[key];
                    if (Array.isArray(sourceType)) {
                        sourceType.forEach(source => {
                            videoSources.push(...mapSource(source, key, duration));
                        });
                    } else {
                        videoSources.push(...mapSource(sourceType, key, duration));
                    }
                }
            }
        } catch (playerDataError) {
            logError(`Error processing playerData: ${playerDataError.message}`);
        }
    }

    // Audio source has diferent duration, and includes some narration in the beginning. Could be used in an audio only mode
    // if(video.audioDownload){
    //     audioSources.push(
    //         new AudioUrlSource({
    //             name: "audio/mp3",
    //             duration: duration,
    //             url: video.audioDownload,
    //             container: "audio/mp3"
    //         })
    //     );
    // }

    return new VideoSourceDescriptor(videoSources);
}

// ====================== UTILITY FUNCTIONS ======================

/**
 * Safely parses JSON and returns null on error
 * @param {string} jsonString JSON string to parse
 * @returns {Object|null} Parsed object or null on error
 */
function safeJsonParse(jsonString) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        logError(`JSON parse error: ${error.message}`);
        return null;
    }
}

/**
 * Safely parses an integer with fallback to 0
 * @param {*} value Value to parse
 * @returns {number} Parsed integer or 0 if invalid
 */
function safeParseInt(value) {
    try {
        const parsed = parseInt(value);
        return isNaN(parsed) ? 0 : parsed;
    } catch (error) {
        return 0;
    }
}

/**
 * Checks if a URL matches a given pattern
 * @param {string} url URL to check
 * @param {RegExp} pattern Regular expression pattern
 * @returns {boolean} True if URL matches pattern
 */
function urlMatches(url, pattern) {
    try {
        return pattern.test(url);
    } catch (error) {
        logError(`URL pattern matching error: ${error.message}`);
        return false;
    }
}

/**
 * Extracts the speaker slug from a TED speaker URL
 * @param {string} url TED speaker URL
 * @returns {string|null} Speaker slug or null if not found
 */
function extractSpeakerSlug(url) {
    try {
        const match = REGEX.SPEAKER_SLUG.exec(url);
        return match ? match[1] : null;
    } catch (error) {
        logError(`Exception in extractSpeakerSlug: ${error.message}`);
        return null;
    }
}

/**
 * Extracts the speaker ID from a TED speaker URL
 * @param {string} url TED speaker URL
 * @returns {string|null} Speaker ID or null if not found
 */
function extractSpeakerId(url) {
    try {
        const match = REGEX.SPEAKER_ID.exec(url);
        return match ? match[1] : null;
    } catch (error) {
        logError(`Exception in extractSpeakerId: ${error.message}`);
        return null;
    }
}

/**
 * Extracts the video slug from a TED Talk URL
 * @param {string} url TED Talk URL
 * @returns {string|null} Video slug or null if not found
 */
function extractTedSlug(url) {
    try {
        const match = REGEX.TALK_SLUG.exec(url);
        return match ? match[1] : null;
    } catch (error) {
        logError(`Exception in extractTedSlug: ${error.message}`);
        return null;
    }
}

/**
 * Extracts talk slugs from HTML content
 * @param {string} html HTML content
 * @param {string} channelSlug Channel slug for filtering
 * @returns {Array<string>} Array of talk slugs
 */
function extractTalkSlugsFromHtml(html) {
    try {
        const talkElements = domParser
            .parseFromString(html, 'text/html')
            .querySelectorAll('div.profile-talks__talk');
        
        if (!talkElements || talkElements.length === 0) {
            return [];
        }
        
        return Array
            .from(talkElements)
            .map(el => {
                const a = el.querySelector('a.ga-link');
                if (!a) return null;
                
                const relativelinkUrl = a.getAttribute('href');
                if (!relativelinkUrl) return null;
                
                return extractTedSlug(`${PLATFORM.BASE_URL}${relativelinkUrl}`);
            })
            .filter(Boolean);
    } catch (error) {
        logError(`Error extracting talk slugs from HTML: ${error.message}`);
        return [];
    }
}

/**
 * Formats a speaker's description combining multiple fields
 * @param {Object} speaker Speaker data
 * @returns {string} Formatted description
 */
function formatSpeakerDescription(speaker) {
    let description = speaker.description || '';
    
    if (speaker.whoTheyAre) {
        description += `<p>${speaker.whoTheyAre}</p>`;
    }
    
    if (speaker.whyListen) {
        description += '<p><b>Why Listen</b></p>';
        description += `${speaker.whyListen}\n`;
    }
    
    if (speaker.whatOthersSay) {
        description += '<p><b>What Others Say</b></p>';
        description += `${speaker.whatOthersSay}\n`;
    }
    
    return description;
}

/**
 * Formats a full name from first and last name
 * @param {string} firstName First name
 * @param {string} lastName Last name
 * @returns {string} Formatted full name
 */
function formatName(firstName, lastName) {
    return `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown';
}

/**
 * Extracts thumbnail URL from video data
 * @param {Object} video Video data
 * @returns {string} Thumbnail URL or empty string
 */
function extractThumbnailUrl(video) {
    try {
        if (video?.playerData) {
            const playerData = safeJsonParse(video.playerData);
            return playerData?.thumb || '';
        }
        return '';
    } catch (error) {
        logError(`Error extracting thumbnail: ${error.message}`);
        return '';
    }
}

/**
 * Converts a date string to Unix timestamp in seconds
 * @param {string} date Date string
 * @returns {number|null} Unix timestamp or null if invalid
 */
function dateToUnixSeconds(date) {
    try {
        if (!date) {
            return null;
        }
        return Math.round(Date.parse(date) / 1000);
    } catch (error) {
        logError(`Date conversion error: ${error.message}`);
        return null;
    }
}

/**
 * Creates an empty content pager
 * @returns {ContentPager} Empty pager
 */
function createEmptyPager() {
    return new ContentPager([], false);
}

/**
 * Logs an error message
 * @param {string} message Error message
 */
function logError(message) {
    bridge.log(`[TED Talks Plugin] ${message}`);
}

/**
 * Shows a toast message to the user
 * @param {string} message Toast message
 */
function showToast(message) {
    bridge.toast(message);
}

// ====================== GRAPHQL QUERIES ======================

const GQL_QUERIES = {
    HOME_VIDEOS: `
query Videos($first: Int, $after: String) {
	videos(first: $first, after: $after) {
		nodes {
			nativeDownloads {
				high
				low
				medium
			}
            canonicalUrl
			audioDownload
			playerData
			duration
			description
			hlsUrl
			slug
			id
			language
			publishedAt
			title
			viewedCount
			speakers {
				nodes {
					id
					firstname
					lastname
					slug
					photoUrl
				}
			}
		}
		pageInfo {
			endCursor
			hasNextPage
			startCursor
		}
	}
}

`,
    VIDEO_DETAILS: `
    query shareLinks($slug: String!, $language: String) {
        videos(
            slug: [$slug]
            language: $language
            first: 1
            isPublished: [true, false]
            channel: ALL
        ) {
            nodes {
                id
                viewedCount
                playerData
                publishedAt
                hlsUrl
                canonicalUrl
                title
                description
                relatedVideos {
                    title
                    slug
                    id
                    duration
                    hlsUrl
                    canonicalUrl
                    videoDownloads {
                        nodes {
                            url
                        }
                    }
                    viewedCount
                    publishedAt
                    recordedOn
                    speakers {
                        nodes {
                            id
                            firstname
                            lastname
                            slug
                            photoUrl
                        }
                    }
                }
                duration
                speakers {
                    nodes {
                        id
                        firstname
                        lastname
                        slug
                        photoUrl
                    }
                }
                nativeDownloads {
                    low
                    medium
                    high
                }
            }
        }
    }
    `,
    VIDEOS_INFO_BY_SLUG: `
    query videosInfo($slug: [String!]) {
        videos(slug: $slug, first: 50, isPublished: [true, false], channel: ALL) {
            nodes {
                id
                title
                slug
                hlsUrl
                description
                canonicalUrl
                viewedCount
                publishedAt
                duration
                playerData
                speakers {
                    nodes {
                        id
                        firstname
                        lastname
                        slug
                        photoUrl
                    }
                }
                nativeDownloads {
                    low
                    medium
                    high
                }
            }
            totalCount
        }
    }
    `,
    SPEAKER_BY_ID: `
    query acmeSpeaker($id: ID!) {
        acmeSpeaker(id: $id) {
            id
            cite
            firstname
            lastname
            title
            photoUrl
            description
            slug
            whyListen
            whatOthersSay
            whoTheyAre
        }
    }
    `,
    RELATED: `
    query related($slug: String!, $language: String) {
	videos(
		slug: [$slug]
		language: $language
		first: 1
		isPublished: [true]
		channel: ALL
	) {
		nodes {
			relatedVideos {
				title
				slug
				id
				duration
				hlsUrl
                canonicalUrl
				videoDownloads {
					nodes {
						url
					}
				}
				viewedCount
				publishedAt
				recordedOn
				speakers {
					nodes {
						id
						firstname
						lastname
						slug
						photoUrl
					}
				}
			}
		}
	}
}
    `
};

log('LOADED');