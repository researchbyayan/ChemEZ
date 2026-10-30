# ChemEZ data handling

ChemEZ stores conversation text, attached images, generated diagrams, cached image
observations and model configuration in a local SQLite database in its application
data directory. Draft text and interface preferences also use local browser storage.
These files are not an encrypted database. Protect access to your operating-system
account and any backups you create.

API keys are saved in `credentials.json` in ChemEZ’s data folder, readable only by your user account (permissions 0600), never in the chat database or chats. The operating-system keychain is not used.
Session-only mode keeps keys in memory; keys must be re-entered after closing or
restarting that service. Keys are not included in SQLite conversation backups.

Your selected provider receives the question and relevant conversation context.
Without a separate image reader, a capable chat model also receives attached
images. With a separate reader, images go to that service and its text observations
go to the chat service. Both services' account terms and data retention apply.
Model discovery and connection checks also contact the configured service; the
image-reader connection check sends a generated blank image.

The installed app asks GitHub for the latest ChemEZ release at launch and every few
hours. That request sends no conversation data; downloading an update happens only
when you click **Update**.

ChemEZ does not include analytics, remote fonts, automatic cloud conversation sync,
or remote error reporting. Optional evaluation capture is a developer-only explicit
environment setting; it writes test prompts and outputs to a local folder. It must
stay disabled when handling private user conversations.

Deleting a chat removes its local messages, searchable records and derived library
entries. It does not erase data already sent to a provider, exported files,
independent backups or copies held by another application. Removing a key and
removing a conversation are separate actions. Deleting a conversation does not
require deleting the key used by other conversations.
