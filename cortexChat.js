class CortexChat {
    constructor(jwt, agentUrl, model, searchService, semanticModels) {
        this.jwt = jwt;
        this.agentUrl = agentUrl;
        this.model = model;
        this.searchService = searchService;
        this.semanticModels = semanticModels;
    }

    async _retrieveResponse(query, limit = 1) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.jwt}`
        };

        const data = {
            model: this.model,
            messages: [{ role: "user", content: [{ type: "text", text: query }] }],
            tools: [
                { tool_spec: { type: "cortex_search", name: "vehicles_info_search" } },
                { tool_spec: { type: "cortex_analyst_text_to_sql", name: "support" } },
                { tool_spec: { type: "cortex_analyst_text_to_sql", name: "supply_chain" } }
            ],
            tool_resources: {
                vehicles_info_search: {
                    name: this.searchService,
                    max_results: limit,
                    title_column: "title",
                    id_column: "relative_path"
                },
                support: { semantic_model_file: this.semanticModels[0] },
                supply_chain: { semantic_model_file: this.semanticModels[1] }
            }
        };

        try {
            const response = await fetch(this.agentUrl, { method: "POST", headers, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(`Response status: ${response.status}`);
            return await this._parseResponse(response);
        } catch (error) {
            console.error("Error fetching response:", error);
            return { text: "Yooo, error occurred." };
        }
    }

    // Streaming async generator: yields partial text as it comes
    async *streamResponse(query, limit = 1) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.jwt}`
        };

        const data = {
            model: this.model,
            messages: [{ role: "user", content: [{ type: "text", text: query }] }],
            tools: [
                { tool_spec: { type: "cortex_search", name: "vehicles_info_search" } },
                { tool_spec: { type: "cortex_analyst_text_to_sql", name: "support" } },
                { tool_spec: { type: "cortex_analyst_text_to_sql", name: "supply_chain" } }
            ],
            tool_resources: {
                vehicles_info_search: {
                    name: this.searchService,
                    max_results: limit,
                    title_column: "title",
                    id_column: "relative_path"
                },
                support: { semantic_model_file: this.semanticModels[0] },
                supply_chain: { semantic_model_file: this.semanticModels[1] }
            }
        };

        try {
            const response = await fetch(this.agentUrl, { method: "POST", headers, body: JSON.stringify(data) });
            if (!response.ok) throw new Error(`Response status: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    // This chunk may contain multiple SSE lines — split by '\n\n' or similar
                    const sseEvents = chunk.split(/\n\n/).filter(Boolean);
                    for (const eventText of sseEvents) {
                        const processed = this._processSSELine(eventText);
                        if (processed.type === "message") {
                            yield processed.content.text; // yield partial text chunk
                        }
                        if (processed.type === "done") {
                            done = true;
                            break;
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error fetching or streaming response:", error);
            yield "Error occurred while streaming response.";
        }
    }

    async _parseResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = { text: "", tool_results: [] };
        let done = false;
    
        while (!done) {
            const { value, done: readerDone } = await reader.read();
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                const result = this._processSSELine(chunk);
                if (result.type === "message") {
                    accumulated.text += result.content.text;
                    accumulated.tool_results.push(...result.content.tool_results);
                }
            }
            done = readerDone;
        }
    
        let text = accumulated.text;
        let sql = "";
        let citations = "";
    
        // Process tool_results which contains objects with 'content' array
        if (Array.isArray(accumulated.tool_results)) {
            accumulated.tool_results.forEach(result => {
                if (result.content && Array.isArray(result.content)) {
                    result.content.forEach(contentItem => {
                        if (contentItem.json) {
                            // Check for SQL in the json object
                            if (contentItem.json.sql) {
                                sql = contentItem.json.sql;
                            }
    
                            // Check for searchResults in the json object
                            if (contentItem.json.searchResults) {
                                contentItem.json.searchResults.forEach(searchResult => {
                                    citations += `${searchResult.text}`;
                                    text = text.replace(/【†[1-3]†】/g, "").replace(" .", ".") + "+";
                                    citations = ` \n\r ${citations} \n\n[Source: ${searchResult.doc_id}]`;
                                });
                            }
                        }
                    });
                } else {
                    console.warn("Unexpected structure in content:", result.content);
                }
            });
        } else {
            console.warn("tool_results is not an array:", accumulated.tool_results);
        }
    
        return { text, sql, citations };
    }    
    
    _processSSELine(eventText) {
        try {
            // eventText contains lines like "event: message.delta\ndata: {...}"
            // We want to extract the data JSON only

            const lines = eventText.split("\n");
            const dataLine = lines.find(l => l.startsWith("data: "));
            if (!dataLine) return { type: "other" };
            const jsonStr = dataLine.slice(6).trim();
            if (jsonStr === "[DONE]") return { type: "done" };

            const data = JSON.parse(jsonStr);
            if (data.object === "message.delta" && data.delta.content) {
                return { type: "message", content: this._parseDeltaContent(data.delta.content) };
            }
            return { type: "other", data };
        } catch (error) {
            return { type: "error", message: `Failed to parse: ${eventText}` };
        }
    }

    _parseDeltaContent(content) {
        return content.reduce((acc, entry) => {
            if (entry.type === "text") acc.text += entry.text;
            else if (entry.type === "tool_results") acc.tool_results.push(entry.tool_results);
            return acc;
        }, { text: "", tool_results: [] });
    }

}

module.exports = CortexChat;
