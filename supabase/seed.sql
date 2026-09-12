-- ============================================
-- NEWGRAD RADAR - SEED DATA
-- 110 target companies across 6 tiers
-- Run after 001_initial.sql migration
-- ============================================

INSERT INTO companies (slug, name, tier, ats_type, ats_token, logo_url) VALUES

-- ============================================
-- FAANG (7)
-- ============================================
('meta', 'Meta', 'faang', 'custom', NULL, 'https://logo.clearbit.com/meta.com'),
('apple', 'Apple', 'faang', 'custom', NULL, 'https://logo.clearbit.com/apple.com'),
('amazon', 'Amazon', 'faang', 'custom', NULL, 'https://logo.clearbit.com/amazon.com'),
('netflix', 'Netflix', 'faang', 'lever', 'netflix', 'https://logo.clearbit.com/netflix.com'),
('google', 'Google', 'faang', 'custom', NULL, 'https://logo.clearbit.com/google.com'),
('microsoft', 'Microsoft', 'faang', 'custom', NULL, 'https://logo.clearbit.com/microsoft.com'),
('nvidia', 'Nvidia', 'faang', 'workday', NULL, 'https://logo.clearbit.com/nvidia.com'),

-- ============================================
-- HOT AI (40)
-- ============================================
('anthropic', 'Anthropic', 'ai', 'greenhouse', 'anthropic', 'https://logo.clearbit.com/anthropic.com'),
('openai', 'OpenAI', 'ai', 'greenhouse', 'openai', 'https://logo.clearbit.com/openai.com'),
('coreweave', 'CoreWeave', 'ai', 'greenhouse', 'coreweave', 'https://logo.clearbit.com/coreweave.com'),
('together-ai', 'Together AI', 'ai', 'greenhouse', 'togetherai', 'https://logo.clearbit.com/together.ai'),
('anyscale', 'Anyscale', 'ai', 'greenhouse', 'anyscale', 'https://logo.clearbit.com/anyscale.com'),
('modal', 'Modal', 'ai', 'greenhouse', 'modal-labs', 'https://logo.clearbit.com/modal.com'),
('fireworks-ai', 'Fireworks AI', 'ai', 'greenhouse', 'fireworks-ai', 'https://logo.clearbit.com/fireworks.ai'),
('groq', 'Groq', 'ai', 'greenhouse', 'groq', 'https://logo.clearbit.com/groq.com'),
('mistral', 'Mistral AI', 'ai', 'greenhouse', 'mistral', 'https://logo.clearbit.com/mistral.ai'),
('perplexity', 'Perplexity', 'ai', 'greenhouse', 'perplexity', 'https://logo.clearbit.com/perplexity.ai'),
('cursor', 'Cursor', 'ai', 'greenhouse', 'anysphere', 'https://logo.clearbit.com/cursor.sh'),
('replit', 'Replit', 'ai', 'lever', 'replit', 'https://logo.clearbit.com/replit.com'),
('sourcegraph', 'Sourcegraph', 'ai', 'greenhouse', 'sourcegraph', 'https://logo.clearbit.com/sourcegraph.com'),
('tabnine', 'Tabnine', 'ai', 'greenhouse', 'tabnine', 'https://logo.clearbit.com/tabnine.com'),
('character-ai', 'Character AI', 'ai', 'greenhouse', 'character', 'https://logo.clearbit.com/character.ai'),
('inflection', 'Inflection AI', 'ai', 'greenhouse', 'inflection', 'https://logo.clearbit.com/inflection.ai'),
('adept', 'Adept', 'ai', 'greenhouse', 'adept-ai', 'https://logo.clearbit.com/adept.ai'),
('runway', 'Runway', 'ai', 'lever', 'runwayml', 'https://logo.clearbit.com/runwayml.com'),
('midjourney', 'Midjourney', 'ai', 'custom', NULL, 'https://logo.clearbit.com/midjourney.com'),
('stability-ai', 'Stability AI', 'ai', 'greenhouse', 'stability-ai', 'https://logo.clearbit.com/stability.ai'),
('descript', 'Descript', 'ai', 'greenhouse', 'descript', 'https://logo.clearbit.com/descript.com'),
('jasper', 'Jasper', 'ai', 'greenhouse', 'jasper-ai', 'https://logo.clearbit.com/jasper.ai'),
('copy-ai', 'Copy.ai', 'ai', 'lever', 'copy-ai', 'https://logo.clearbit.com/copy.ai'),
('writer', 'Writer', 'ai', 'greenhouse', 'writer', 'https://logo.clearbit.com/writer.com'),
('coframe', 'Coframe', 'ai', 'ashby', 'coframe', 'https://logo.clearbit.com/coframe.ai'),
('weights-biases', 'Weights & Biases', 'ai', 'greenhouse', 'wandb', 'https://logo.clearbit.com/wandb.com'),
('pinecone', 'Pinecone', 'ai', 'greenhouse', 'pinecone', 'https://logo.clearbit.com/pinecone.io'),
('weaviate', 'Weaviate', 'ai', 'greenhouse', 'weaviate', 'https://logo.clearbit.com/weaviate.io'),
('langchain', 'LangChain', 'ai', 'ashby', 'langchain', 'https://logo.clearbit.com/langchain.com'),
('eleven-labs', 'Eleven Labs', 'ai', 'ashby', 'elevenlabs', 'https://logo.clearbit.com/elevenlabs.io'),
('suno', 'Suno', 'ai', 'ashby', 'suno', 'https://logo.clearbit.com/suno.ai'),
('pika', 'Pika', 'ai', 'greenhouse', 'pika-labs', 'https://logo.clearbit.com/pika.art'),
('luma-ai', 'Luma AI', 'ai', 'greenhouse', 'lumalabs', 'https://logo.clearbit.com/lumalabs.ai'),
('harvey-ai', 'Harvey AI', 'ai', 'greenhouse', 'harvey', 'https://logo.clearbit.com/harvey.ai'),
('glean', 'Glean', 'ai', 'greenhouse', 'glean', 'https://logo.clearbit.com/glean.com'),
('hebbia', 'Hebbia', 'ai', 'greenhouse', 'hebbia', 'https://logo.clearbit.com/hebbia.ai'),
('sierra-ai', 'Sierra AI', 'ai', 'greenhouse', 'sierra-ai', 'https://logo.clearbit.com/sierra.ai'),
('cohere', 'Cohere', 'ai', 'greenhouse', 'cohere', 'https://logo.clearbit.com/cohere.com'),
('huggingface', 'Hugging Face', 'ai', 'greenhouse', 'huggingface', 'https://logo.clearbit.com/huggingface.co'),
('replicate', 'Replicate', 'ai', 'ashby', 'replicate', 'https://logo.clearbit.com/replicate.com'),

-- ============================================
-- UNICORNS (33)
-- ============================================
('stripe', 'Stripe', 'unicorn', 'greenhouse', 'stripe', 'https://logo.clearbit.com/stripe.com'),
('databricks', 'Databricks', 'unicorn', 'greenhouse', 'databricks', 'https://logo.clearbit.com/databricks.com'),
('figma', 'Figma', 'unicorn', 'greenhouse', 'figma', 'https://logo.clearbit.com/figma.com'),
('notion', 'Notion', 'unicorn', 'greenhouse', 'notion', 'https://logo.clearbit.com/notion.so'),
('canva', 'Canva', 'unicorn', 'greenhouse', 'canva', 'https://logo.clearbit.com/canva.com'),
('discord', 'Discord', 'unicorn', 'greenhouse', 'discord', 'https://logo.clearbit.com/discord.com'),
('reddit', 'Reddit', 'unicorn', 'greenhouse', 'reddit', 'https://logo.clearbit.com/reddit.com'),
('instacart', 'Instacart', 'unicorn', 'greenhouse', 'instacart', 'https://logo.clearbit.com/instacart.com'),
('doordash', 'DoorDash', 'unicorn', 'greenhouse', 'doordash', 'https://logo.clearbit.com/doordash.com'),
('coinbase', 'Coinbase', 'unicorn', 'greenhouse', 'coinbase', 'https://logo.clearbit.com/coinbase.com'),
('robinhood', 'Robinhood', 'unicorn', 'greenhouse', 'robinhood', 'https://logo.clearbit.com/robinhood.com'),
('plaid', 'Plaid', 'unicorn', 'greenhouse', 'plaid', 'https://logo.clearbit.com/plaid.com'),
('ramp', 'Ramp', 'unicorn', 'greenhouse', 'ramp', 'https://logo.clearbit.com/ramp.com'),
('brex', 'Brex', 'unicorn', 'greenhouse', 'brex', 'https://logo.clearbit.com/brex.com'),
('airtable', 'Airtable', 'unicorn', 'greenhouse', 'airtable', 'https://logo.clearbit.com/airtable.com'),
('clickup', 'ClickUp', 'unicorn', 'greenhouse', 'clickup', 'https://logo.clearbit.com/clickup.com'),
('linear', 'Linear', 'unicorn', 'greenhouse', 'linear', 'https://logo.clearbit.com/linear.app'),
('vercel', 'Vercel', 'unicorn', 'greenhouse', 'vercel', 'https://logo.clearbit.com/vercel.com'),
('supabase', 'Supabase', 'unicorn', 'ashby', 'supabase', 'https://logo.clearbit.com/supabase.com'),
('retool', 'Retool', 'unicorn', 'greenhouse', 'retool', 'https://logo.clearbit.com/retool.com'),
('webflow', 'Webflow', 'unicorn', 'greenhouse', 'webflow', 'https://logo.clearbit.com/webflow.com'),
('scale-ai', 'Scale AI', 'unicorn', 'greenhouse', 'scaleai', 'https://logo.clearbit.com/scale.com'),
('rippling', 'Rippling', 'unicorn', 'greenhouse', 'rippling', 'https://logo.clearbit.com/rippling.com'),
('flexport', 'Flexport', 'unicorn', 'greenhouse', 'flexport', 'https://logo.clearbit.com/flexport.com'),
('navan', 'Navan', 'unicorn', 'greenhouse', 'navan', 'https://logo.clearbit.com/navan.com'),
('grammarly', 'Grammarly', 'unicorn', 'greenhouse', 'grammarly', 'https://logo.clearbit.com/grammarly.com'),
('miro', 'Miro', 'unicorn', 'greenhouse', 'miro', 'https://logo.clearbit.com/miro.com'),
('asana', 'Asana', 'unicorn', 'greenhouse', 'asana', 'https://logo.clearbit.com/asana.com'),
('amplitude', 'Amplitude', 'unicorn', 'greenhouse', 'amplitude', 'https://logo.clearbit.com/amplitude.com'),
('datadog', 'Datadog', 'unicorn', 'greenhouse', 'datadog', 'https://logo.clearbit.com/datadoghq.com'),
('snowflake', 'Snowflake', 'unicorn', 'workday', NULL, 'https://logo.clearbit.com/snowflake.com'),
('cloudflare', 'Cloudflare', 'unicorn', 'greenhouse', 'cloudflare', 'https://logo.clearbit.com/cloudflare.com'),
('palantir', 'Palantir', 'unicorn', 'greenhouse', 'palantir', 'https://logo.clearbit.com/palantir.com'),

-- ============================================
-- YC NOTABLE (19)
-- ============================================
('airbnb', 'Airbnb', 'yc', 'greenhouse', 'airbnb', 'https://logo.clearbit.com/airbnb.com'),
('dropbox', 'Dropbox', 'yc', 'greenhouse', 'dropbox', 'https://logo.clearbit.com/dropbox.com'),
('twitch', 'Twitch', 'yc', 'greenhouse', 'twitch', 'https://logo.clearbit.com/twitch.tv'),
('cruise', 'Cruise', 'yc', 'greenhouse', 'cruise', 'https://logo.clearbit.com/getcruise.com'),
('faire', 'Faire', 'yc', 'greenhouse', 'faire', 'https://logo.clearbit.com/faire.com'),
('ginkgo', 'Ginkgo Bioworks', 'yc', 'greenhouse', 'ginkgobioworks', 'https://logo.clearbit.com/ginkgobioworks.com'),
('rappi', 'Rappi', 'yc', 'lever', 'rappi', 'https://logo.clearbit.com/rappi.com'),
('meesho', 'Meesho', 'yc', 'lever', 'meesho', 'https://logo.clearbit.com/meesho.com'),
('razorpay', 'Razorpay', 'yc', 'lever', 'razorpay', 'https://logo.clearbit.com/razorpay.com'),
('gusto', 'Gusto', 'yc', 'greenhouse', 'gusto', 'https://logo.clearbit.com/gusto.com'),
('checkr', 'Checkr', 'yc', 'greenhouse', 'checkr', 'https://logo.clearbit.com/checkr.com'),
('weave', 'Weave', 'yc', 'greenhouse', 'getweave', 'https://logo.clearbit.com/getweave.com'),
('deel', 'Deel', 'yc', 'ashby', 'deel', 'https://logo.clearbit.com/deel.com'),
('lattice', 'Lattice', 'yc', 'greenhouse', 'lattice', 'https://logo.clearbit.com/lattice.com'),
('ironclad', 'Ironclad', 'yc', 'greenhouse', 'ironclad', 'https://logo.clearbit.com/ironcladapp.com'),
('vanta', 'Vanta', 'yc', 'greenhouse', 'vanta', 'https://logo.clearbit.com/vanta.com'),
('mercury', 'Mercury', 'yc', 'greenhouse', 'mercury', 'https://logo.clearbit.com/mercury.com'),
('opensea', 'OpenSea', 'yc', 'greenhouse', 'opensea', 'https://logo.clearbit.com/opensea.io'),
('fleek', 'Fleek', 'yc', 'lever', 'fleek', 'https://logo.clearbit.com/fleek.co'),

-- ============================================
-- FINTECH (5)
-- ============================================
('affirm', 'Affirm', 'fintech', 'greenhouse', 'affirm', 'https://logo.clearbit.com/affirm.com'),
('klarna', 'Klarna', 'fintech', 'greenhouse', 'klarna', 'https://logo.clearbit.com/klarna.com'),
('chime', 'Chime', 'fintech', 'greenhouse', 'chime', 'https://logo.clearbit.com/chime.com'),
('sofi', 'SoFi', 'fintech', 'greenhouse', 'sofi', 'https://logo.clearbit.com/sofi.com'),
('marqeta', 'Marqeta', 'fintech', 'greenhouse', 'marqeta', 'https://logo.clearbit.com/marqeta.com'),

-- ============================================
-- INFRA / DEV TOOLS (6)
-- ============================================
('hashicorp', 'HashiCorp', 'infra', 'greenhouse', 'hashicorp', 'https://logo.clearbit.com/hashicorp.com'),
('confluent', 'Confluent', 'infra', 'greenhouse', 'confluent', 'https://logo.clearbit.com/confluent.io'),
('mongodb', 'MongoDB', 'infra', 'greenhouse', 'mongodb', 'https://logo.clearbit.com/mongodb.com'),
('planetscale', 'PlanetScale', 'infra', 'ashby', 'planetscale', 'https://logo.clearbit.com/planetscale.com'),
('neon', 'Neon', 'infra', 'ashby', 'neondatabase', 'https://logo.clearbit.com/neon.tech'),
('turso', 'Turso', 'infra', 'ashby', 'turso', 'https://logo.clearbit.com/turso.tech')

ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  ats_type = EXCLUDED.ats_type,
  ats_token = EXCLUDED.ats_token,
  logo_url = EXCLUDED.logo_url;

-- ============================================
-- VERIFY SEED DATA
-- ============================================
-- SELECT tier, COUNT(*) as count FROM companies GROUP BY tier ORDER BY count DESC;
-- Expected: ai (40), unicorn (33), yc (19), faang (7), infra (6), fintech (5) = 110 total
