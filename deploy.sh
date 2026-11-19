#!/bin/sh
set -eu

PRE_RELEASE=${PRE_RELEASE:-false}  # Default to false if not set

# Determine deployment directory
if [ "$PRE_RELEASE" = "true" ]; then
    RELATIVE_PATH="pre-release/TedTalks"
else
    RELATIVE_PATH="TedTalks"
fi

sh "$(dirname "$0")/publish-r2.sh" "$RELATIVE_PATH" TedTalksConfig.json TedTalksConfig.json TedTalksScript.js TedTalksIcon.png media/speaker.png:media/speaker.png
