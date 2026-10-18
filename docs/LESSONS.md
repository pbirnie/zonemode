# Lessons Learnt from Building This Project

## Goal of the Project

Choose a real-world problem that you need to solve.

In this case it is:

- Spending too much time watching YouTube videos
- Vloggers being verbose in order to get more advert segments
- Avoiding distraction from videos unrelated to what I am watching
- Ability to share summaries with friends who prefer text content

## Starting Point

Given the issues above, I started looking for a Chrome extension.

### Reasons for Looking at an Open Source Plugin

- I don’t want to pay a subscription
- Privacy concerns and security issues

**Found:**  
https://github.com/avarayr/youtube-summarizer-oss

### Issues with the youtube-summarizer-oss Plugin

- Simple usability issue with finding the extension-specific configuration panel
- Not possible to configure the summarisation prompt
- Bugs downloading the video transcript

## What I Learnt from Using This as a Starting Point

- Basic project layout for a Chrome extension
- How to inject content into a YouTube page
- Use of Bun to compile code
- How to invoke OpenRouter

### Speeding Up the Modify–Build–Test Loop

- Used Bun, which is ~100× faster than Node.js for compilation
- Set up Bun to run as a watcher and automatically recompile the project

### Diagnostic – Logs

- Improved logging so that all logs go through a common function
- Added a logs diagnostic panel so that you can see the logs on the page

### Diagnostic – Version Sync Issues

- It is really important to know which version is running
- Added an enhancements page under the settings panel so that it is easy to check if the code and the live extension are out of sync

### Switching to Using Standard Libraries

Simply ask Grok about the problem of “downloading transcripts in YouTube and which Node libraries work best for solving this problem”.  
Then choose one and ask Cursor to switch the code to it and test it.

Examples where this was done:

- Transcript downloader
- Client library for calling OpenRouter

### Benchmark Before Full Integration

In the end, a complex video classifier was abandoned because, for a lot of videos, the title and description do not contain enough information for a one-shot classifier to work. It would be possible to get better classification from more content on the video, but this involves downloading the transcript.

It would have been better to start with the test bench page and evaluate effectiveness before going through all the complexity of service pages.

### Write a 

## Summary

High-level summary:

- Using Cursor, it is easy to work in a new language (TypeScript) and domain (browser extensions)
- If you can find a good open-source starting point for your project, this can speed things up and show you best practices in that domain
- Always consider benchmarking in a simple test environment before adding all the complexity to the existing code — only to later discover it does not provide the effect required
