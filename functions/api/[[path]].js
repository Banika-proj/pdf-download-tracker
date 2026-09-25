// The Desk — PDF Download Tracker
// Cloudflare Pages Function: serves /api/* routes, backed by a D1 database.
// The D1 binding must be named "DB" (Pages dashboard → Settings → Functions →
// D1 database bindings → Variable name: DB). See SETUP.md.

const SEED_PUBLICATIONS = [
["Travel Daily Asia","Newsletter to pubs mailbox","daily",null,null,null,1],
["Londonist Newsletter","Newsletter to pubs mailbox","daily",null,null,null,1],
["CoStar News","Newsletter to pubs mailbox","daily",null,null,null,1],
["Breaking Travel News Daily","Newsletter to pubs mailbox","daily",null,null,null,1],
["Asian Lite","https://epaper.asianlite.com/","daily",null,null,null,1],
["Irish Independent","https://epaper.independentnewsstand.ie/titles","daily",null,null,null,1],
["Insider Daily (North West Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (West Midlands Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (South West Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (Yorkshire) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (East Midlands Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (South East Business)","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (Wales Business)","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (North East Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (Irish Business)","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Insider Daily (Liverpool Business) Newsletter","http://www.insidermedia.com/newsletters/index.html","daily",null,null,null,1],
["Jersey Evening Post","https://webapp.pagesuite.com/app/JEEVPO","daily",null,null,null,1],
["Morning Star","https://morningstaronline.co.uk/digital-edition","daily",null,null,null,1],
["Evening Telegraph (Dundee)","https://www.thecourier.co.uk/evening-telegraph-epaper/","daily",null,null,null,1],
["Seniors Housing Weekly News","Newsletter to pubs mailbox","weekly","Monday",null,null,1],
["Weekly Tribune","Arrives as PDF in mailbox","weekly","Monday",null,null,1],
["SoGlos","arrives in mailbox","weekly","Monday",null,null,1],
["Rise & Shine Newsletter","arrives in mailbox","weekly","Monday",null,null,1],
["Tyrone Herald","https://edition.pagesuite.com/html5/reader/production/default.aspx?pubname=&pubid=7807a26b-00fc-4b3c-8004-bd2c3f715cf9","weekly","Monday",null,null,1],
["Automotive News (USA)","emailed to publications Mailbox each friday","weekly","Monday",null,null,1],
["Irish Sunday Independent","https://epaper.independentnewsstand.ie/titles","weekly","Sunday",null,null,1],
["TMB Weekly","arrives in mailbox","weekly","Tuesday",null,null,1],
["Newry Democrat","https://www.newrydemocrat.com/","weekly","Tuesday",null,null,1],
["Computer Weekly","https://www.computerweekly.com/","weekly","Tuesday",null,null,1],
["Moneysaving Expert","Newsletter to pubs mailbox","weekly","Tuesday",null,null,1],
["Slice Newsletter (Metro)","Publication mailbox","weekly","Wednesday",null,null,1],
["Locks & Security News","http://www.locksandsecuritynews.com","weekly","Wednesday",null,null,1],
["Education Journal","emailed to publications Mailbox each friday","weekly","Wednesday",null,null,1],
["Insider Daily (Central & East)","emailed to publications Mailbox each friday","weekly","Wednesday",null,null,1],
["Tyrone Courier","https://www.tyronecourier.co.uk/","weekly","Wednesday",null,null,1],
["Farm Week","https://farmweek.com/page-turner/","weekly","Thursday",null,null,1],
["Ulster Herald","https://wearetyrone.com/","weekly","Thursday",null,null,1],
["Strabane Chronicle","https://wearetyrone.com/","weekly","Thursday",null,null,1],
["Cleanzine, The","Newsletter to pubs mailbox","weekly","Thursday",null,null,1],
["Times Higher Education Supplement","https://www.timeshighereducation.com/academic/digital-editions","weekly","Thursday",null,null,1],
["Ballymena Guardian","https://www.ballymenaguardian.co.uk/","weekly","Thursday",null,null,1],
["Coleraine Chronicle","https://www.colerainechronicle.co.uk/","weekly","Thursday",null,null,1],
["Strabane Weekly News","https://www.strabaneweekly.co.uk/","weekly","Thursday",null,null,1],
["Tyrone Constitution","https://www.tyronecon.co.uk/","weekly","Thursday",null,null,1],
["Ulster Gazette & Armagh Standard","https://www.ulstergazette.co.uk/","weekly","Thursday",null,null,1],
["Antrim Guardian","https://www.antrimguardian.co.uk/","weekly","Thursday",null,null,1],
["Waitrose Weekend","https://www.waitrose.com/ecom/content/inspiration/at-home-with-us/publications","weekly","Thursday",null,null,1],
["Fishing News","https://shop.kelsey.co.uk/digital-issues/fishing-news-weekly-magazine","weekly","Thursday",null,null,1],
["Oban Times","https://www.westcoasttoday.co.uk/digital-editions-channel","weekly","Thursday","subscriptions@gorkana.com","Discovery28",1],
["New European, The","https://www.thenewworld.co.uk/page-turner/","weekly","Thursday","subscriptions@gorkana.com","Discovery28",1],
["Wealden Advertiser","https://www.wealdenad.co.uk/","weekly","Friday",null,null,1],
["Argyllshire Advertiser","https://www.westcoasttoday.co.uk/digital-editions-channel","weekly","Friday","subscriptions@gorkana.com","Discovery28",1],
["West Highland Free Press","Arrives in publication mailbox - from Lesley Young","weekly","Friday",null,null,1],
["Property Week","https://www.propertyweek.com/","weekly","Friday",null,null,1],
["FE Week","emailed to publications Mailbox each friday","weekly","Friday",null,null,1],
["Schools Week","https://schoolsweek.co.uk/archive/","weekly","Friday",null,null,1],
["AgriTrade News","emailed to publications Mailbox each friday","weekly","Friday",null,null,1],
["Eastern Eye","https://www.easterneye.biz/magazine/","weekly","Friday",null,null,1],
["Arran Banner","https://www.westcoasttoday.co.uk/digital-editions-channel","weekly","Friday","subscriptions@gorkana.com","Discovery28",1],
["Maidenhead Advertiser","https://maidenhead.baylismediaarchive.co.uk/html5/reader/production/default.aspx?pubname=&pubid=3599e706-98ac-4d6f-920f-d5a5c6bb0c74","weekly","Friday",null,null,1],
["Warminster Journal","emailed to publications Mailbox each Monday or friday","weekly","Friday",null,null,1],
["Borough of Hounslow Herald, The","emailed to publications Mailbox each friday","weekly","Friday",null,null,1],
["Barnsley Chronicle","https://www.barnsleychronicle.com/epaper","weekly","Friday","subscriptions@gorkana.com","Discovery28",1],
["Campbeltown Courier","https://www.westcoasttoday.co.uk/digital-editions-channel","weekly","Friday","subscriptions@gorkana.com","Discovery28",1],
["International Travel Writers Alliance Bulletin","http://www.itwalliance.com/","fortnightly","1st and 15th of each month",null,null,1],
["Legal Moves","arrives in mailbox","fortnightly","15th & 30th of each month",null,null,1],
["Bus & Coach Buyer","http://www.busandcoachbuyer.com/virtual-magazines/","fortnightly","Friday",null,null,1],
["Ileach","http://www.ileach.co.uk/8hc6tk/","fortnightly","Saturday",null,null,1],
["Spa Business Insider","https://www.spaopportunities.com/index.cfm?pagetype=archive","fortnightly","Friday",null,null,1],
["Music Week",null,"monthly",null,null,null,1],
["Waitrose Food",null,"monthly",null,null,null,1],
["Railway Gazette International",null,"monthly",null,null,null,1],
["Engineer, The",null,"monthly",null,null,null,1],
["Food & Drink Technology",null,"monthly",null,null,null,1],
["Public Sector Catering",null,"monthly",null,null,null,1],
["Fruit Grower",null,"monthly",null,null,null,1],
["Cleaning Matters",null,"bi-monthly",null,null,null,1],
["Controls, Drives & Automation",null,"bi-monthly",null,null,null,1],
["Frozen & Chilled Foods",null,"bi-monthly",null,null,null,1],
["Health & Safety Matters",null,"bi-monthly",null,null,null,1],
["Business Leader",null,"quarterly",null,null,null,1],
["National Health Executive",null,"quarterly",null,null,null,1],
["Public Sector Executive",null,"quarterly",null,null,null,1],
["ADS Advance",null,"quarterly",null,null,null,1],
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function normalizePub(p) { return { ...p, isActive: !!p.isActive }; }

const ALLOWED_PUB_FIELDS = new Set(['name','link','frequency','expectedDay','login','password','isActive','deletedAt']);

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;
  const path = params.path || [];
  const method = request.method;

  if (!db) return json({ error: 'D1 binding "DB" is not configured for this Pages project. See SETUP.md.' }, 500);

  try {
    // ---- GET /api/state ----
    if (method === 'GET' && path[0] === 'state') {
      const [pubs, logs, notes] = await Promise.all([
        db.prepare('SELECT * FROM publications').all(),
        db.prepare('SELECT * FROM logs').all(),
        db.prepare('SELECT * FROM notes').all(),
      ]);
      return json({
        publications: pubs.results.map(normalizePub),
        logs: logs.results,
        notes: notes.results,
      });
    }

    // ---- POST /api/seed ----
    if (method === 'POST' && path[0] === 'seed') {
      const count = await db.prepare('SELECT COUNT(*) c FROM publications').first();
      if (count.c === 0) {
        const stmt = db.prepare(
          'INSERT INTO publications (name,link,frequency,expectedDay,login,password,isActive) VALUES (?,?,?,?,?,?,?)'
        );
        const batch = SEED_PUBLICATIONS.map(row => stmt.bind(...row));
        await db.batch(batch);
      }
      return json({ ok: true });
    }

    // ---- POST /api/publications ----
    if (method === 'POST' && path[0] === 'publications' && path.length === 1) {
      const b = await request.json();
      if (!b.name || !b.frequency) return json({ error: 'name and frequency are required' }, 400);
      const res = await db.prepare(
        'INSERT INTO publications (name,link,frequency,expectedDay,login,password,isActive,deletedAt) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(b.name, b.link ?? null, b.frequency, b.expectedDay ?? null, b.login ?? null, b.password ?? null, b.isActive ? 1 : 0, null).run();
      return json({ id: res.meta.last_row_id });
    }

    // ---- PATCH /api/publications/:id ----
    if (method === 'PATCH' && path[0] === 'publications' && path.length === 2) {
      const id = Number(path[1]);
      const b = await request.json();
      const fields = Object.keys(b).filter(f => ALLOWED_PUB_FIELDS.has(f));
      if (!fields.length) return json({ error: 'No valid fields to update' }, 400);
      const setClause = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => (typeof b[f] === 'boolean' ? (b[f] ? 1 : 0) : b[f]));
      await db.prepare(`UPDATE publications SET ${setClause} WHERE id = ?`).bind(...values, id).run();
      return json({ ok: true });
    }

    // ---- DELETE /api/publications/:id (hard delete + cascade) ----
    if (method === 'DELETE' && path[0] === 'publications' && path.length === 2) {
      const id = Number(path[1]);
      await db.batch([
        db.prepare('DELETE FROM logs WHERE publicationId = ?').bind(id),
        db.prepare('DELETE FROM notes WHERE publicationId = ?').bind(id),
        db.prepare('DELETE FROM publications WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }

    // ---- POST /api/logs (upsert by publicationId+logDate) ----
    if (method === 'POST' && path[0] === 'logs' && path.length === 1) {
      const b = await request.json();
      if (!b.publicationId || !b.logDate || !b.downloaded) return json({ error: 'publicationId, logDate, downloaded are required' }, 400);
      await db.prepare(`
        INSERT INTO logs (publicationId, logDate, downloaded, timeDownloaded, reasonWhenNo, createdAt, createdBy)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(publicationId, logDate) DO UPDATE SET
          downloaded=excluded.downloaded, timeDownloaded=excluded.timeDownloaded,
          reasonWhenNo=excluded.reasonWhenNo, createdAt=excluded.createdAt, createdBy=excluded.createdBy
      `).bind(b.publicationId, b.logDate, b.downloaded, b.timeDownloaded ?? null, b.reasonWhenNo ?? null, b.createdAt ?? new Date().toISOString(), b.createdBy ?? 'Unknown').run();
      return json({ ok: true });
    }

    // ---- DELETE /api/logs  (body: {publicationId, logDate}) ----
    if (method === 'DELETE' && path[0] === 'logs' && path.length === 1) {
      const b = await request.json();
      await db.prepare('DELETE FROM logs WHERE publicationId = ? AND logDate = ?').bind(b.publicationId, b.logDate).run();
      return json({ ok: true });
    }

    // ---- POST /api/notes ----
    if (method === 'POST' && path[0] === 'notes' && path.length === 1) {
      const b = await request.json();
      if (!b.publicationId || !b.entryDate || !b.comment) return json({ error: 'publicationId, entryDate, comment are required' }, 400);
      const res = await db.prepare(
        'INSERT INTO notes (publicationId, entryDate, noteDate, comment, createdAt, createdBy) VALUES (?,?,?,?,?,?)'
      ).bind(b.publicationId, b.entryDate, b.noteDate ?? null, b.comment, b.createdAt ?? new Date().toISOString(), b.createdBy ?? 'Unknown').run();
      return json({ id: res.meta.last_row_id });
    }

    // ---- DELETE /api/notes/:id ----
    if (method === 'DELETE' && path[0] === 'notes' && path.length === 2) {
      await db.prepare('DELETE FROM notes WHERE id = ?').bind(Number(path[1])).run();
      return json({ ok: true });
    }

    return json({ error: 'Not found: ' + method + ' /api/' + path.join('/') }, 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}
