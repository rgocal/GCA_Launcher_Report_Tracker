export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Inbound issue submission
    if (url.pathname === "/api/submit" && request.method === "POST") {
      try {
        const p = await request.json();
        const isBug = p.type === "bug";
        
        let body = `### User Description\n${p.description}\n\n`;
        if (p.logcat && p.logcat.trim()) {
          body += `### Logcat Snippet\n\`\`\`shell\n${p.logcat.trim()}\n\`\`\`\n\n`;
        }
        if (p.media_url && p.media_url.trim()) {
          body += `### Attached Media\n${p.media_url.trim()}\n\n`;
        }
        body += `### Diagnostic Telemetry\n- **Reporter:** ${p.is_anonymous ? "Anonymous" : (p.nickname || "Unknown")}\n`;
        if (p.contact_email) body += `- **Email:** ${p.contact_email}\n`;
        body += `- **Device:** ${p.device_manufacturer} ${p.device_model}\n- **Android:** ${p.android_version} (API ${p.sdk_int})\n- **Region:** ${p.region}\n- **Timestamp:** ${p.timestamp}\n`;

        const ghRes = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/issues`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GH_PAT}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Android-Tracker-Relay",
            "X-GitHub-Api-Version": "2022-11-28"
          },
          body: JSON.stringify({
            title: `[${p.type.toUpperCase()}] ${p.title}`,
            body: body,
            labels: [isBug ? "bug" : "enhancement", "in-app-submission"]
          })
        });

        return new Response(JSON.stringify({ success: ghRes.ok }), {
          status: ghRes.status,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // Upvote toggle & KV counter
    if (url.pathname.match(/\/api\/issues\/\d+\/upvote/) && request.method === "POST") {
      const issueId = url.pathname.split("/")[3];
      const { deviceId } = await request.json();
      if (!deviceId) return new Response("Missing deviceId", { status: 400 });

      const voteKey = `vote:${issueId}:${deviceId}`;
      const countKey = `count:${issueId}`;
      const existing = await env.VOTES_KV.get(voteKey);
      let count = parseInt(await env.VOTES_KV.get(countKey) || "0", 10);

      if (existing) {
        await env.VOTES_KV.delete(voteKey);
        count = Math.max(0, count - 1);
      } else {
        await env.VOTES_KV.put(voteKey, "true");
        count += 1;
      }
      await env.VOTES_KV.put(countKey, count.toString());

      return new Response(JSON.stringify({ issueId, count, hasVoted: !existing }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Upvote summary route for GitHub Actions
    if (url.pathname === "/api/issues/votes/summary" && request.method === "GET") {
      const list = await env.VOTES_KV.list({ prefix: "count:" });
      const summary = [];
      for (const k of list.keys) {
        summary.push({
          issueNumber: parseInt(k.name.replace("count:", ""), 10),
          upvotes: parseInt(await env.VOTES_KV.get(k.name) || "0", 10)
        });
      }
      return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Not Found", { status: 404 });
  }
};
