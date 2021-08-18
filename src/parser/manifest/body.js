import AS from 'assert';

import Biffer from '../../../lib/Biffer.js';

import File from '../../entry/manifest/File.js';

import TableParser from './table.js';

import BundleParser from './bundle.js';
import LangParser from './lang.js';
import FileEntryParser from './fileEntry.js';
import DirectoryParser from './directory.js';


export default async function BodyParse(manifests) {
	for(const manifest of manifests) {
		const biffer = new Biffer(manifest.buffer);

		// header (unknown values, skip it)
		const [n] = biffer.unpack('<l');
		biffer.skip(n);

		// offsets to tables(convert to absolute)
		const offsetsBase = biffer.tell();
		const d = biffer.unpack('<6l');
		const offsets = d.map((v, i) => offsetsBase + 4 * i + v);

		biffer.seek(offsets[0]);
		manifest.bundles = await TableParser(biffer, BundleParser);

		biffer.seek(offsets[1]);

		manifest.langs = {};
		(await TableParser(biffer, LangParser)).forEach(lang => manifest.langs[lang.langID] = lang.lang);

		// Build a map of chunks, indexed by ID
		// Some of ChunkIDs are duplicates, but they are always the same size
		manifest.chunks = {};
		for(const bundle of manifest.bundles) {
			for(const chunk of bundle.chunks) {
				AS(!manifest.chunks[chunk.id] || (manifest.chunks[chunk.id].size == chunk.size || manifest.chunks[chunk.id].targetSize == chunk.targetSize));

				manifest.chunks[chunk.id] = chunk;

				chunk.idBundle = bundle.id;
			}
		}

		biffer.seek(offsets[2]);

		manifest.fileEntries = await TableParser(biffer, FileEntryParser);

		biffer.seek(offsets[3]);

		const directories = await TableParser(biffer, DirectoryParser);
		const directories_id = {};
		for(const directory of directories) {
			directories_id[directory.id] = directory;
		}

		// merge files and directory data
		const files = {};
		for(const fileEntry of manifest.fileEntries) {
			const { id, link, langIDs, sizeFile, idsChunk } = fileEntry;
			let { name, idDirectory } = fileEntry;

			while(idDirectory) {
				const directory = directories_id[idDirectory] || {};

				const dirName = directory.name;
				idDirectory = directory.parentID;

				name = `${dirName}/${name}`;
			}

			const langs = (langIDs || []).map(id => manifest.langs[id]);
			const fileChunks = (idsChunk || []).map(id => manifest.chunks[id]);

			files[name] = new File(id, name, sizeFile, link, langs, fileChunks, manifest.version);
		}

		manifest.files = files;
	}
}