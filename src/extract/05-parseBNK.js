import { writeFileSync } from 'fs';
import { parse, resolve } from 'path';

import { readJSONSync } from '../../lib/fs-extra.js';

import { C, G } from '@nuogz/pangu';
import Biffer from '@nuogz/biffer';

import { dirDebug } from '../../lib/dir.js';
import { I } from '../../lib/info.js';
import { toHexL8, showID } from '../../lib/utility.js';

import { HIRCSound, HIRCEventAction, HIRCEvent, HIRCContainer, HIRCSwitchContainer, HIRCObject, HIRCSwitch } from '../entry/bnk/HIRCObject.js';



let mapEventID = {};
try {
	mapEventID = readJSONSync(`../../data/EventIDMap/${I.slot}.json`);
}
catch(error) { void 0; }

const getEventFull = (mapHash_EventName, HIRCEventID) => {
	let eventFull = mapHash_EventName[HIRCEventID];

	while(!eventFull && mapEventID[HIRCEventID]) {
		eventFull = mapHash_EventName[HIRCEventID = mapEventID[HIRCEventID]];
	}

	return eventFull;
};



const fnv_1 = name => {
	let h = 0x811c9dc5n;

	for(const c of name) {
		const b = BigInt(c.toLowerCase().charCodeAt(0));

		h = (h * 0x01000193n) % 0x100000000n;
		h = (h ^ b) % 0x100000000n;
	}

	return h;
};



// 7: Actor Mixer
// 14: Attenuation
const typesUnused = [7, 14];

/**
 * @param {number} id
 * @param {number} type
 * @param {Biffer} B
 */
export const parseHIRCObject = (id, type, B) => {
	let object;
	const objectsExtra = [];

	// Sound
	if(type == 2) {
		const [embedType, audioID, sourceID] = B.unpack('xxxxBLL');

		object = new HIRCSound(id, embedType, audioID, sourceID);

		if(embedType == 0) {
			const [fileIndex, fileLength] = B.unpack('LL');

			object.fileIndex = fileIndex;
			object.fileLength = fileLength;
		}

		const [soundType] = B.unpack('L');

		object.soundType = soundType;
	}
	// Event Action
	else if(type == 3) {
		const [scope, actionType, idObject, countParam] = B.unpack('BBLxB');
		object = new HIRCEventAction(id, scope, actionType, idObject, countParam);

		object.scope = scope;
		object.actionType = actionType;
		object.idObject = idObject;

		const params = object.params = [];

		for(let i = 0; i < countParam; i++) {
			const [type] = B.unpack('B');
			// 0f --> float
			const [value] = B.unpack(type == 0x0E || type == 0x0F ? 'L' : 'L');

			params.push({ type, value });
		}


		if(actionType == 0x12 || actionType == 0x19) {
			const [idGroup, idCondition] = B.unpack('xLL');

			object.idGroup = idGroup;
			object.idCondition = idCondition;
		}
	}
	// Event
	else if(type == 4) {
		const [count] = B.unpack('B');

		object = new HIRCEvent(id, count);

		object.count = count;

		if(count) {
			object.idsAction = B.unpack(`${count}L`);
		}
	}
	// Container
	else if(type == 5) {
		object = new HIRCContainer(id);

		// unknown bytes * 3
		// unknown id * 2 (long)
		B.skip(3 + 4 + 4);

		// 00
		// the number of unknown params (byte);
		const [countParams] = B.unpack('xB');

		// unknown param values (byte each)
		object.params = countParams ? B.unpack(`${countParams}B`).map(type => ({ type })) : [];

		// 00 00
		// unknown param struct each:
		// value (short)
		// 00
		// iguess additional value (byte)
		// iguess additional value==3 + 1 byte
		B.skip(2);
		for(let index = 0; index < countParams; index++) {
			const param = object.params[index];
			[param.value, param.addition] = B.unpack('HxB');

			if(param.addition == 3) {
				[param.valueAddition] = B.unpack('B');
			}
			else if(param.addition == 2) {
				param.valueAddition = B.unpack('2Lx');
			}
			else if(param.addition == 204) {
				void 0;
			}
			else if(param.addition) {
				G.warn('BNKParser', 'unknown ~[container param addition]', `~{${param.addition}}`);
			}
		}

		// 00 00
		// unknown id * 2 (long)
		// 00
		// unknown id * 2 (long)
		// unknown id * 2 (long)
		// 00 00
		// unknown short + 00
		// unknown short + 00
		B.skip(
			2 +
			4 + 4 +
			1 +
			4 + 4 +
			4 + 4 +
			2 +
			2 + 1 +
			2 + 1
		);


		// 00
		// the number of sound id (long)
		const [countSound] = B.unpack('L');

		// sound ids (long each)
		try {
			object.idsSound = B.unpack(`${countSound}L`);
		} catch(error) {
			debugger;
		}
	}
	// Switch Container
	else if(type == 6) {
		object = new HIRCSwitchContainer(id);

		// unknown bytes * 3
		// unknown id * 2 (long)
		B.skip(3 + 4 + 4);

		// 00
		// the number of unknown params (byte);
		const [countParams] = B.unpack('xB');

		// unknown param values (byte each)
		object.params = countParams ? B.unpack(`${countParams}B`).map(type => ({ type })) : [];

		// 00 00
		// unknown param struct each:
		// value (short)
		// 00
		// iguess additional value (byte)
		// iguess additional value==3 + 1 byte
		B.skip(2);
		for(let index = 0; index < countParams; index++) {
			const param = object.params[index];
			[param.value, param.addition] = B.unpack('HxB');

			if(param.addition == 3) {
				[param.valueAddition] = B.unpack('B');
			}

			if(param.addition && param.addition != 3) {
				G.warn('BNKParser', 'unknown ~[switch container param addition]', `~{${param.addition}}`);
			}
		}

		// 00 00
		// unknown id * 2 (long)
		// 00 00
		B.skip(2 + 4 + 4 + 2);


		// group id (long)
		// default switch id (long)
		[object.idGroup, object.idSwitchDefault] = B.unpack('LL');


		// 00
		// the number of sound id (long)
		const [countSound] = B.unpack('xL');

		// sound ids (long each)
		object.idsSound = B.unpack(`${countSound}L`);


		// the number of switch (long)
		const [countSwitch] = B.unpack('L');

		// switch
		object.switches = [];
		for(let index = 0; index < countSwitch; index++) {
			// id (long)
			// the number of sound (long)
			const [id, countSoundSwitch] = B.unpack(`LL`);

			// sound ids (long each)
			const sw = new HIRCSwitch(id, B.unpack(`${countSoundSwitch}L`));

			object.switches.push(sw);
			objectsExtra.push(sw);
		}
	}
	else if(!typesUnused.includes(type)) {
		G.error('HIRCObjectParser', `unknown HIRC Object Type: ${type} ${id}`);

		object = new HIRCObject(id, type);
	}


	return [object, objectsExtra];
};


/**
 * @param {HIRCObject} objectParsed
 * @param {HIRCObject[]} objectsAll
 * @param {number} idHIRC
 * @returns {number{}}
 */
const parseActionSoundObject = (objectParsed, objectsAll, idHIRC) => {
	const result = [];

	if(objectParsed instanceof HIRCSound) {
		result.push(objectParsed.audioID);
	}
	else if(objectParsed instanceof HIRCContainer) {
		const objects = objectsAll.filter(object => objectParsed.idsSound.includes(object.id));

		for(const object of objects) {
			for(const eventAudio of parseActionSoundObject(object, objectsAll)) {
				result.push(eventAudio);
			}
		}
	}
	else if(objectParsed instanceof HIRCSwitchContainer) {
		const objects = [...new Set([
			...objectsAll.filter(object => objectParsed.idsSound.includes(object.id)),
			...objectParsed.switches,
		])];

		for(const object of objects) {
			for(const eventAudio of parseActionSoundObject(object, objectsAll)) {
				result.push(eventAudio);
			}
		}
	}
	else if(objectParsed instanceof HIRCSwitch) {
		const objects = objectsAll.filter(object => objectParsed.idsSound.includes(object.id));

		for(const object of objects) {
			for(const eventAudio of parseActionSoundObject(object, objectsAll)) {
				result.push(eventAudio);
			}
		}
	}
	else if(!objectParsed && idHIRC) {
		G.warn('BNKParser', 'unknown ~[action object id]', `~{${showID(idHIRC)}}`);
	}
	else if(objectParsed) {
		G.warn('BNKParser', 'unknown ~[action sound object]', objectParsed);
	}

	return result;
};



const parseTree = (object, id, objects, texts, level = 0) => {
	if(!object) {
		if(id) { return texts.push(`${'\t'.repeat(level)}UnknownObject:${showID(id)}`); }

		return;
	}

	texts.push(`${'\t'.repeat(level)}${object.toString()}`);


	if(object instanceof HIRCEvent) {
		for(const idAction of object.idsAction) {
			parseTree(objects.find(o => o.id == idAction), idAction, objects, texts, level + 1);
		}

		texts.push('');
	}
	else if(object instanceof HIRCEventAction) {
		parseTree(objects.find(o => o.id == object.idObject), object.idObject, objects, texts, level + 1);
	}
	else if(
		object instanceof HIRCContainer ||
		object instanceof HIRCSwitchContainer ||
		object instanceof HIRCSwitch
	) {
		if(object instanceof HIRCSwitchContainer) {
			object.switches.forEach(sw => texts.push(`${'\t'.repeat(level + 1)}${sw.toString()}`));
		}

		for(const idSound of object.idsSound) {
			const objectChild = objects.find(e => e.id == idSound);

			parseTree(objectChild, idSound, objects, texts, level + 1);
		}
	}
};



/**
 * @param {string} fileBNK
 * @param {Set<string>} setNameEvent
 */
export default async function parseBNK(fileBNK, setNameEvent) {
	G.infoU('BNKParser', `parse BNK~{${parse(fileBNK).base}}`, 'parsing...');

	const bifferBNK = new Biffer(fileBNK);

	const objects = [];

	while(!bifferBNK.isEnd()) {
		const [magicSection, sizeSection] = bifferBNK.unpack('4sL');

		if(magicSection == 'HIRC') {
			const bifferSection = bifferBNK.sub(sizeSection);

			const [countObject] = bifferSection.unpack('L');

			for(let i = 0; i < countObject; i++) {
				const [type, length, id] = bifferSection.unpack('BLL');

				G.trace('BNKParser', `HIRC object ~[${toHexL8(id)}]`, `~[position]~{${toHexL8(bifferSection.tell() + 10, null, false)}} ~[type]~{${type}} ~[length]~{${length}}`);

				const [objectSection, objectsExtra] = parseHIRCObject(id, type, bifferSection.sub(length - 4));

				if(objectSection) { objects.push(objectSection); }

				objects.push(...objectsExtra);
			}
		}
		else {
			bifferBNK.skip(sizeSection);

			if(magicSection != 'BKHD') {
				G.warn('BNKParser', 'unknown ~[BNK section magic]', `~{${magicSection}}`);
			}
		}
	}



	const mapHash_EventName = {};
	const mapAudioID_EventName = {};

	for(const event of setNameEvent) {
		mapHash_EventName[fnv_1(event)] = event;
	}

	const objectsEvent = objects.filter(object => object instanceof HIRCEvent);

	for(const objectEvent of objectsEvent) {
		const eventsAudio = [];

		let eventFull = getEventFull(mapHash_EventName, objectEvent.id);

		if(!eventFull) {
			G.warn('BNKParser', 'unknown ~[HIRC Event ID]', `~{${objectEvent.id}}`);

			eventFull = objectEvent.id;
		}

		objectEvent.eventFull = eventFull;

		for(const actionID of objectEvent.idsAction) {
			const action = objects.find(object => object.id == actionID);

			const actionSoundObject = objects.find(object => object.id == action.idObject);

			for(const eventAudio of parseActionSoundObject(actionSoundObject, objects, action.idObject)) {
				eventsAudio.push(eventAudio);
			}
		}

		for(const audioID of eventsAudio) {
			(mapAudioID_EventName[audioID] || (mapAudioID_EventName[audioID] = new Set())).add(eventFull);
		}
	}

	const mapAudioID_SoundID = {};

	objects.filter(object => object instanceof HIRCSound).forEach(sound =>
		(mapAudioID_SoundID[sound.audioID] || (mapAudioID_SoundID[sound.audioID] = new Set())).add(sound.id)
	);


	// extract debug info

	// const textsSoundAudio = [];
	// objects.filter(object => object instanceof HIRCSound).forEach(object =>
	// 	textsSoundAudio.push(`${showID(object.id)} --> ${showID(object.audioID)}`)
	// );

	// writeFileSync(
	// 	resolve(dirDebug, `[${I.slot}@${C.server.region}@${C.lang}]@${parse(fileBNK).base}@${I.time}@sound.txt`),
	// 	textsSoundAudio.join('\n')
	// );


	// const textsEvent = [];
	// objects.filter(object => object instanceof HIRCEvent)
	// 	.forEach(object =>
	// 		textsEvent.push(showID(object.id))
	// 	);

	// writeFileSync(
	// 	resolve(dirDebug, `[${I.slot}@${C.server.region}@${C.lang}]@${parse(fileBNK).base}@${I.time}@event.txt`),
	// 	textsEvent.join('\n')
	// );


	const textsTree = [];
	for(const object of objects.filter(object => object instanceof HIRCEvent)) {
		parseTree(object, object.id, objects, textsTree);
	}
	writeFileSync(
		resolve(dirDebug, `[${I.slot}@${C.server.region}@${C.lang}]@${parse(fileBNK).base}@${I.time}@tree.txt`),
		textsTree.join('\n')
	);


	G.infoD('BNKParser', `parse BNK~{${parse(fileBNK).base}}`, '✔ ');

	return [mapAudioID_EventName, mapAudioID_SoundID];
}
