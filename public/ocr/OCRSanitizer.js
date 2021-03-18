const OCRSanitizer = (function() {

/*
 * OCRSanitizer sanitizes a stream of Tetris OCRed data.
 *
 * That is because with intelaced input, a change occurs over 2 frame.
 * Reading a value as soon as it is changed can yield incorrect values, since the OCR was performed on
 * a transition interlaced frame
 *
 * So, each change is buffered for 1 frame to hopefully read a clean stable value.
 *
 * The buffering is done with an understanding of how Tetris fields are connected
 * Score: may change independently (push down points), but also always changes with lines increase
 * Lines: can change independently
 * Level: Only changes if lines changes too
 * Piece counters: Can change independently (but only one at a time!)
 * Instant Das: changes at every frame: cannot be buffered to stability (read and hope for the best)
 * Cur piece Das: Changes on piece change
 * Preview: Can change independently
 * Cur piece:  Can change independently
 *
 * The Sanitizer Also corrects invalid detection on the high scores and level, where scores greater than 1M are rendered with letter.
 */

class OCRSanitizer {
	constructor(tetris_ocr, config) {
		this.config = config;
		this.tetris_ocr = tetris_ocr;

		this.last_frame = null;

		this.score_fixer = new ScoreFixer();
		this.level_fixer = new LevelFixer();

		this.handleFirstFrame = this.handleFirstFrame.bind(this);
		this.sanitize = timingDecorator('sanitize', this.sanitize.bind(this));

		tetris_ocr.onMessage = this.handleFirstFrame;

		this.gameid = 1;
		this.in_game = false;

		this.pending_score = false;
		this.pending_line = false;
		this.pending_piece = false;
	}

	onMessage() {
		// class user to implement
	}

	handleFirstFrame(data) {
		this.last_frame = { ...data }; // first frame is assumed "good" - because no choice!
		this.previous_preview = data.preview; // used in das trainer to populate the current_frame

		tetris_ocr.onMessage = this.sanitize;
	}

	sanitize(data) {
		do {
			if (this.pending_lines) {
				this.pending_lines = false;

				this.last_frame.lines = data.lines;
				this.last_frame.level = data.level;

				// a line change always has a score change
				// if score readwas not pending, force a read now anyway to synchronize with the lines
				this.pending_score = true;
			}
			else if (!OCRSanitizer.arrEqual(data.lines, last_frame.lines)) {
				this.pending_lines = true;

				if (this.pending_score) {
					// because score was already pending, the lines value is (probably) already
					// clean to read but we somehow didn't detect the change previously
					// let's read it right away after all by looping back up!
					continue;
				}
			}

			break;
		}
		while(true);

		// ==========

		if (this.pending_score) {
			this.pending_score = false;

			this.last_frame.score = data.score;
		}
		else if (!OCRSanitizer.arrEqual(data.score, last_frame.score)) {
			this.pendig_score = true;
		}

		// ==========

		// mutually exclusive pendding_piece checks based on selected rom
		if (this.config.tasks.T) {
			// In classic rom, we can determine cur_piece as the previous preview
			// that only fails on the first piece but works for all pieces thereafter
			// TODO: compute the cur_piece into the frame for classic rom (maybe?)
			if (this.pending_piece) {
				this.pending_piece = false;

				this.last_frame.preview = data.preview;
				this.last_frame.T = data.T;
				this.last_frame.J = data.J;
				this.last_frame.Z = data.Z;
				this.last_frame.O = data.O;
				this.last_frame.S = data.S;
				this.last_frame.L = data.L;
				this.last_frame.I = data.I;
			}
			else if (!OCRSanitizer.pieceCountersEqual(this.last_frame, data)) {
				this.pending_piece = true;
			}
		}
		else if (this.config.tasks.instant_das) {
			if (this.pending_piece) {
				this.pending_piece = false;

				this.last_frame.preview = data.preview;
				this.last_frame.cur_piece_das = data.cur_piece_das;
				this.last_frame.cur_piece = data.cur_piece;
			}
			else if (!OCRSanitizer.arrEqual(data.cur_piece_das, last_frame.cur_piece_das)) {
				this.pending_piece = true;
			}
		}


		// ==========
		// we have now corrected the reads to be on stable values
		// the stable values may still be incorrect with regards to the 8-B and 4-A detection
		// but that wouldbe fixed in the next step

		// inform listener that a frame is ready
		this.emitLastFrameData();

		// Finally, record current frame for next iteration
		this.last_frame = data;
	}

	emitLastFrameData() {
		// check if the fixers must be reset
		if (this.last_frame.lines == null || this.last_frame.score == null || this.last_frame.level == null) {
			this.in_game = false;
		}
		else if (!this.in_game) {
			this.in_game = true;

			if (
				OCRSanitizer.arrEqual(this.last_frame.score, [0, 0, 0, 0, 0, 0])
				&&
				(
					OCRSanitizer.arrEqual(this.last_frame.lines, [0, 0, 0]) // mode A
					||
					OCRSanitizer.arrEqual(this.last_frame.lines, [0, 2, 5]) // mode B
				)
			) {
				this.gameid++;

				this.score_fixer.reset();
				this.score_fixer.fix(this.last_frame.score);

				this.level_fixer.reset();
				this.level_fixer.fix(this.last_frame.level);
			}
		}

		const pojo = {
			gameid:  this.gameid,
			lines:   OCRSanitizer.digitsToValue(this.last_frame.lines),
			field:   this.last_frame.field,
			preview: this.last_frame.preview,

			score:   this.last_frame.score ? OCRSanitizer.digitsToValue(this.score_fixer.fix(this.last_frame.score)) : null,
			level:   this.last_frame.level ? OCRSanitizer.digitsToValue(this.level_fixer.fix(this.last_frame.level)) : null,
		};


		if (this.config.tasks.T) {
			pojo.T = OCRSanitizer.digitsToValue(this.last_frame.T);
			pojo.J = OCRSanitizer.digitsToValue(this.last_frame.J);
			pojo.Z = OCRSanitizer.digitsToValue(this.last_frame.Z);
			pojo.O = OCRSanitizer.digitsToValue(this.last_frame.O);
			pojo.S = OCRSanitizer.digitsToValue(this.last_frame.S);
			pojo.L = OCRSanitizer.digitsToValue(this.last_frame.L);
			pojo.I = OCRSanitizer.digitsToValue(this.last_frame.I);
		}
		else {
			popo.instant_das = OCRSanitizer.digitsToValue(this.last_frame.instant_das);
			popo.cur_piece_das = OCRSanitizer.digitsToValue(this.last_frame.cur_piece_das);
			popo.cur_piece = this.last_frame.cur_piece;
		}

		this.onMessage(pojo);
	}
}


OCRSanitizer.digitsToValue = function digitsToValue(digits) {
	return digits.reverse().reduce((acc, v, idx) => acc += v * Math.pow(10, idx), 0);
}

OCRSanitizer.arrEqual = function arrEqual(arr1, arr2) {
	return (
		(arr1 === null && arr2 === null)
		||
		(arr1 && arr2 && arr1.length === arr2.length && arr1.every((v, i) => v === arr2[i]))
	);
}

OCRSanitizer.pieceCountersEqual = function pieceCountersEqual(frame1, frame2) {
	return (
		   OCRSanitizer.arrEqual(frame1.T, frame2.T)
		&& OCRSanitizer.arrEqual(frame1.J, frame2.J)
		&& OCRSanitizer.arrEqual(frame1.Z, frame2.Z)
		&& OCRSanitizer.arrEqual(frame1.O, frame2.O)
		&& OCRSanitizer.arrEqual(frame1.S, frame2.S)
		&& OCRSanitizer.arrEqual(frame1.L, frame2.L)
		&& OCRSanitizer.arrEqual(frame1.I, frame2.I)
	);
}

return OCRSanitizer;

})();