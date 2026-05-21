import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

interface Scripts {
    scan: string
    getResults: string
    getResultsSummary: string
    saveResults: string
}

interface Command {
    name: string
    class: string
}

/**
 * Commands the SDK always wraps for accessibility scans, on top of the
 * commandsToWrap list returned by the backend launch response.
 *
 * The backend list (see `util.ts:processAccessibilityResponse`) is curated for
 * user-meaningful UI actions, but it does not currently include `waitUntil`
 * (Element + Browser) or `pause` (Browser). These two commands are however
 * meaningful scan triggers:
 *   - `waitUntil` underlies every `waitFor*` Element command (e.g.,
 *     `waitForDisplayed` → `this.waitUntil(...)`), which is the canonical
 *     "settle the page, then scan" anchor before a click / addValue.
 *   - `pause` is the canonical "wait for transition" anchor before assertions.
 *
 * Without these, customers running WDIO + Accessibility see their scan-trigger
 * coverage drop (SDK-4117 — App Automate v9 capture missed `waitUntil`/`pause`
 * relative to v8 expectations).
 *
 * Keep this list minimal — only add commands the backend response is missing
 * AND that are stable WDIO command surface across v8/v9.
 */
const SUPPLEMENTAL_COMMANDS: Command[] = [
    { name: 'waitUntil', class: 'Element' },
    { name: 'waitUntil', class: 'Browser' },
    { name: 'pause', class: 'Browser' },
]

const mergeSupplementalCommands = (commands: Command[] | null | undefined): Command[] => {
    const base: Command[] = Array.isArray(commands) ? commands.slice() : []
    const seen = new Set(base.map((c) => `${c.name}::${c.class}`))
    for (const supp of SUPPLEMENTAL_COMMANDS) {
        const key = `${supp.name}::${supp.class}`
        if (!seen.has(key)) {
            base.push(supp)
            seen.add(key)
        }
    }
    return base
}

class AccessibilityScripts {
    private static instance: AccessibilityScripts | null = null

    public performScan: string | null = null
    public getResults: string | null = null
    public getResultsSummary: string | null = null
    public saveTestResults: string | null = null
    public commandsToWrap: Array<Command> | null = null
    public ChromeExtension: { [key: string]: unknown } = {}

    public browserstackFolderPath = ''
    public commandsPath = ''

    // don't allow to create instances from it other than through `checkAndGetInstance`
    private constructor() {
        this.browserstackFolderPath = this.getWritableDir()
        this.commandsPath = path.join(this.browserstackFolderPath, 'commands.json')
    }

    public static checkAndGetInstance() {
        if (!AccessibilityScripts.instance) {
            AccessibilityScripts.instance = new AccessibilityScripts()
            AccessibilityScripts.instance.readFromExistingFile()
        }
        return AccessibilityScripts.instance
    }

    /* eslint-disable @typescript-eslint/no-unused-vars */
    public getWritableDir(): string {
        const orderedPaths = [
            path.join(os.homedir(), '.browserstack'),
            process.cwd(),
            os.tmpdir()
        ]
        for (const orderedPath of orderedPaths) {
            try {
                if (fs.existsSync(orderedPath)) {
                    fs.accessSync(orderedPath)
                    return orderedPath
                }

                fs.mkdirSync(orderedPath, { recursive: true })
                return orderedPath

            } catch (error) {
                /* no-empty */
            }
        }
        return ''
    }

    public readFromExistingFile() {
        try {
            if (fs.existsSync(this.commandsPath)) {
                const data = fs.readFileSync(this.commandsPath, 'utf8')
                if (data) {
                    this.update(JSON.parse(data))
                }
            }
        } catch {
            /* Do nothing */
        }
    }

    public update(data: { commands: [], scripts: Scripts, nonBStackInfraA11yChromeOptions: {} }) {
        if (data.scripts) {
            this.performScan = data.scripts.scan
            this.getResults = data.scripts.getResults
            this.getResultsSummary = data.scripts.getResultsSummary
            this.saveTestResults = data.scripts.saveResults
        }
        if (data.commands && data.commands.length) {
            // Backend list is the source of truth; supplemental commands are merged
            // on top (deduped by name+class) so the SDK always wraps `waitUntil` /
            // `pause` even if the backend response omits them (SDK-4117).
            this.commandsToWrap = mergeSupplementalCommands(data.commands as unknown as Command[])
        }
        if (data.nonBStackInfraA11yChromeOptions){
            this.ChromeExtension = data.nonBStackInfraA11yChromeOptions
        }

    }

    public store() {
        if (!fs.existsSync(this.browserstackFolderPath)){
            fs.mkdirSync(this.browserstackFolderPath)
        }

        fs.writeFileSync(this.commandsPath, JSON.stringify({
            commands: this.commandsToWrap,
            scripts: {
                scan: this.performScan,
                getResults: this.getResults,
                getResultsSummary: this.getResultsSummary,
                saveResults: this.saveTestResults,
            },
            nonBStackInfraA11yChromeOptions: this.ChromeExtension,
        }))
    }
}

export default AccessibilityScripts.checkAndGetInstance()
export { Command }
