// Defines the data contract shared by each versioned release note module

interface ReleaseNoteSection {
	heading: string;
	changes: readonly string[];
}

export interface ReleaseNotes {
	releasedAt: string;
	summary: string;
	sections: readonly ReleaseNoteSection[];
}
