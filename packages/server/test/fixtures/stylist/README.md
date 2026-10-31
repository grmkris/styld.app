# Stylist fixtures

`glm-step-0.json` to `glm-step-2.json` are Workers AI's real answers, recorded on 31 October 2026, from
`@cf/zai-org/glm-5.3-flash` with `reasoning_effort: low`. They answer one reply to "What should I wear today? Something
casual." through Styld's own turn (`src/stylist/Turn.ts`), with the stylist's system prompt and a made-up wardrobe of four
pieces (`Stylist.test.ts`): a `piece_search`, then words with `pieces_show` of the four pieces, then a short last line. The
requests went to the OpenAI-compatible REST endpoint, which takes the same Chat Completions body as the Worker's `AI`
binding. Nothing in them belongs to a real person.

`deepseek-step-0.json` to `deepseek-step-2.json` are the same reply from `@cf/deepseek-ai/deepseek-v4.1-flash-1017`,
recorded the same day through the run endpoint the Worker's binding mirrors, with the prompt that also asks for no
narration: words saying it will take a look beside three `piece_search` calls at once, then `pieces_show` alone, then
the words of the reply.
