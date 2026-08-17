# campaign-state

The campaign's memory, kept in the repository on purpose.

A scheduled run happens in a container that is created for it and destroyed
afterwards. Without somewhere durable to write, every run would start from
nothing: it would re-queue professors it had already written to, send a second
copy of an email it had already sent, and lose the record that it had done so.

Supabase would solve that. So does this, without another service to run: the
run reads the state, does its work, writes the state back, and commits it. The
next run clones the repository and picks up where the last one stopped.

## What is in here

| Prefix | What it holds |
| --- | --- |
| `target__` | One campaign target: the professor, the draft, when it sends, what happened |
| `outbox__` | One email actually sent |
| `email__` | An address the finder agent read off a page |
| `emailhunt__` | Where it looked and what it found, so nobody is re-crawled nightly |
| `opportunity__` | Whether a lab says it is recruiting |
| `contacts__` | Assistants and lab members worth copying |
| `works__` | A researcher's publication record, cached |
| `tracks__` | How far each research track is through its approval gate |
| `user__`, `resume__`, `rules__`, `template__` | The sender's profile, resume, standing instructions, templates |
| `routinerun__` | The log of what each run did |

## What is deliberately not in here

Secrets. The OAuth refresh token for the university mailbox and the NIM API key
are excluded by `.gitignore` in this directory and come from the environment
instead. Committing a live token for somebody's email account is not a
reasonable price for convenient scheduling.
