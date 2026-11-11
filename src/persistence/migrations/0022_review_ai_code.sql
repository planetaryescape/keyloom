-- Why a review's look was refused, as a code the page maps to its buttons (#288 review): "no_credits" adds Add credits beside Try
-- again. Null for a look that finished, failed for another reason, or ran before this column existed.
ALTER TABLE board_reviews ADD COLUMN ai_code TEXT;
